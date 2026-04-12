import { ipdrAPI } from '@/components/lib/apis'
import {
  ingestCaseUploadsDetailed,
  type CaseUploadSlotKey,
  type CaseUploadStatusUpdate,
  type IngestCaseUploadsParams,
} from '@/lib/caseFileIngestion'
import {
  useCaseIngestionStore,
  type CaseIngestionRun,
  type CaseIngestionTask,
} from '@/stores/caseIngestionStore'
import { markPerformanceEvent, trackPerformanceAsync } from '@/lib/performance'

type UploadLike = {
  key: CaseUploadSlotKey
  label?: string
  files: File[]
}

interface StartCaseIngestionRunParams {
  caseId: number | string
  operator: string
  uploads: UploadLike[]
}

const toTaskId = (slotKey: string, fileName: string, index: number) =>
  `${slotKey}:${index}:${fileName}`.replace(/\s+/g, '_')

const buildTasks = (runId: string, caseId: string, uploads: UploadLike[]): CaseIngestionTask[] => {
  const now = new Date().toISOString()
  const tasks: CaseIngestionTask[] = []

  uploads.forEach((upload) => {
    upload.files.forEach((file, index) => {
      tasks.push({
        id: toTaskId(upload.key, file.name, index),
        runId,
        caseId,
        slotKey: upload.key,
        fileName: file.name,
        status: 'queued',
        message: 'Queued for processing.',
        createdAt: now,
        updatedAt: now,
      })
    })
  })

  return tasks
}

const mapStatusToMessage = (status: string, fallback: string) => {
  switch (status) {
    case 'parsing':
      return fallback || 'Parsing file contents...'
    case 'uploading':
      return fallback || 'Uploading file...'
    case 'classifying':
      return fallback || 'Finalizing uploaded file...'
    case 'ingesting':
      return fallback || 'Ingesting parsed records...'
    case 'enriching':
      return fallback || 'Enriching IP intelligence...'
    case 'completed':
      return fallback || 'Completed.'
    case 'failed':
      return fallback || 'Processing failed.'
    default:
      return fallback || 'Queued for processing.'
  }
}

export const startCaseIngestionRun = async ({
  caseId,
  operator,
  uploads,
}: StartCaseIngestionRunParams) => {
  const filteredUploads = uploads.filter((upload) => Array.isArray(upload.files) && upload.files.length > 0)
  if (filteredUploads.length === 0) return null

  const resolvedCaseId = String(caseId)
  const runId = `run:${resolvedCaseId}:${Date.now()}`
  const store = useCaseIngestionStore.getState()
  const tasks = buildTasks(runId, resolvedCaseId, filteredUploads)
  const taskIdByKey = new Map(
    tasks.map((task) => [`${task.slotKey}:${task.fileName}`, task.id] as const)
  )

  const run: CaseIngestionRun = {
    id: runId,
    caseId: resolvedCaseId,
    status: 'running',
    totalTasks: tasks.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  store.startRun(run, tasks)
  markPerformanceEvent('case-ingestion.run-started', {
    caseId: resolvedCaseId,
    runId,
    totalTasks: tasks.length,
  })

  const ingestParams: IngestCaseUploadsParams = {
    caseId: Number(caseId),
    operator,
    uploads: filteredUploads.map((upload) => ({
      key: upload.key,
      label: upload.label || upload.key.toUpperCase(),
      files: upload.files,
    })),
    autoEnrichIpdr: false,
    onStatusUpdate: (update: CaseUploadStatusUpdate) => {
      const taskId = taskIdByKey.get(`${update.slotKey}:${update.fileName}`)
      if (!taskId) return
      useCaseIngestionStore.getState().updateTask(taskId, {
        status: update.status,
        insertedRecords: update.insertedCount,
        error: update.status === 'failed' ? update.message : null,
        message: mapStatusToMessage(update.status, update.message || ''),
      })
    },
  }

  try {
    const result = await trackPerformanceAsync(
      'case-ingestion.run',
      () => ingestCaseUploadsDetailed(ingestParams),
      {
        caseId: resolvedCaseId,
        runId,
        totalTasks: tasks.length,
      },
    )
    const hasFailures = result.failures.length > 0

    if (result.insertedIpdrRecords > 0) {
      const enrichTaskId = `ipdr:enrichment`
      useCaseIngestionStore.getState().startRun(
        {
          ...run,
          totalTasks: tasks.length + 1,
          updatedAt: new Date().toISOString(),
        },
        [
        {
          id: enrichTaskId,
          runId,
          caseId: resolvedCaseId,
          slotKey: 'ipdr',
          fileName: 'IP enrichment',
          status: 'enriching',
          message: 'Enriching IP intelligence in the background...',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      try {
        const enrichment = await trackPerformanceAsync(
          'case-ingestion.ipdr-enrichment',
          () => ipdrAPI.enrichCase(resolvedCaseId, 5000),
          { caseId: resolvedCaseId, runId },
        )
        useCaseIngestionStore.getState().updateTask(enrichTaskId, {
          status: 'completed',
          insertedRecords: Number(enrichment.updatedRows || 0),
          message: `IP enrichment completed for ${Number(enrichment.updatedRows || 0).toLocaleString()} row${Number(enrichment.updatedRows || 0) === 1 ? '' : 's'}.`,
          error: null,
        })
      } catch (error) {
        useCaseIngestionStore.getState().updateTask(enrichTaskId, {
          status: 'failed',
          message: 'IP enrichment could not be completed.',
          error: error instanceof Error ? error.message : 'IP enrichment failed',
        })
      }
    }

    useCaseIngestionStore
      .getState()
      .completeRun(runId, hasFailures ? 'completed_with_errors' : 'completed')
    markPerformanceEvent('case-ingestion.run-completed', {
      caseId: resolvedCaseId,
      runId,
      failures: result.failures.length,
      insertedIpdrRecords: result.insertedIpdrRecords,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Case ingestion failed'
    tasks.forEach((task) => {
      const current = useCaseIngestionStore.getState().tasks[task.id]
      if (!current || current.status === 'completed' || current.status === 'failed') return
      useCaseIngestionStore.getState().updateTask(task.id, {
        status: 'failed',
        message,
        error: message,
      })
    })
    useCaseIngestionStore.getState().completeRun(runId, 'failed')
    markPerformanceEvent('case-ingestion.run-failed', {
      caseId: resolvedCaseId,
      runId,
      error: message,
    })
    throw error
  }
}
