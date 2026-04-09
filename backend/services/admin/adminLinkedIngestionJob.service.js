const buildStoredFileNameMatch = (jobAlias, uploadAlias) =>
  `LOWER(NULLIF(REGEXP_REPLACE(COALESCE(${jobAlias}.storage_path, ''), '^.*[\\\\/]', ''), '')) = LOWER(${uploadAlias}.file_name)`;

const buildUniqueOriginalNameMatch = (jobAlias, uploadAlias) => `
  LOWER(${jobAlias}.original_filename) = LOWER(COALESCE(${uploadAlias}.original_name, ${uploadAlias}.file_name))
  AND NOT EXISTS (
    SELECT 1
    FROM uploaded_files upload_conflict
    WHERE upload_conflict.id <> ${uploadAlias}.id
      AND upload_conflict.case_id IS NOT DISTINCT FROM ${uploadAlias}.case_id
      AND LOWER(COALESCE(upload_conflict.original_name, upload_conflict.file_name)) = LOWER(COALESCE(${uploadAlias}.original_name, ${uploadAlias}.file_name))
  )
`;

export const buildLinkedIngestionJobLateral = (uploadAlias = 'uf', jobAlias = 'latest_job') => `
  LEFT JOIN LATERAL (
    WITH ranked_matches AS (
      SELECT
        ij.*,
        CASE
          WHEN ij.file_id = ${uploadAlias}.id THEN 0
          WHEN ${buildStoredFileNameMatch('ij', uploadAlias)} THEN 1
          WHEN ${buildUniqueOriginalNameMatch('ij', uploadAlias)} THEN 2
          ELSE 99
        END AS match_rank,
        ABS(EXTRACT(EPOCH FROM (COALESCE(ij.completed_at, ij.created_at) - ${uploadAlias}.uploaded_at))) AS upload_distance_seconds
      FROM ingestion_jobs ij
      WHERE
        ij.file_id = ${uploadAlias}.id
        OR (
          ij.file_id IS NULL
          AND ij.case_id IS NOT DISTINCT FROM ${uploadAlias}.case_id
          AND (
            ${buildStoredFileNameMatch('ij', uploadAlias)}
            OR ${buildUniqueOriginalNameMatch('ij', uploadAlias)}
          )
        )
    )
    SELECT *
    FROM ranked_matches
    WHERE match_rank < 99
    ORDER BY match_rank ASC, upload_distance_seconds ASC NULLS LAST, created_at DESC
    LIMIT 1
  ) ${jobAlias} ON TRUE
`;

export const buildBackfillIngestionJobLinksSql = () => `
  WITH ranked_matches AS (
    SELECT
      ij.id AS job_id,
      uf.id AS file_id,
      ROW_NUMBER() OVER (
        PARTITION BY ij.id
        ORDER BY
          CASE
            WHEN LOWER(NULLIF(REGEXP_REPLACE(COALESCE(ij.storage_path, ''), '^.*[\\\\/]', ''), '')) = LOWER(uf.file_name) THEN 0
            ELSE 1
          END ASC,
          ABS(EXTRACT(EPOCH FROM (COALESCE(ij.completed_at, ij.created_at) - uf.uploaded_at))) ASC NULLS LAST,
          uf.uploaded_at DESC,
          uf.id DESC
      ) AS match_rank
    FROM ingestion_jobs ij
    JOIN uploaded_files uf
      ON uf.case_id IS NOT DISTINCT FROM ij.case_id
    WHERE ij.file_id IS NULL
      AND (
        LOWER(NULLIF(REGEXP_REPLACE(COALESCE(ij.storage_path, ''), '^.*[\\\\/]', ''), '')) = LOWER(uf.file_name)
        OR (
          LOWER(ij.original_filename) = LOWER(COALESCE(uf.original_name, uf.file_name))
          AND NOT EXISTS (
            SELECT 1
            FROM uploaded_files upload_conflict
            WHERE upload_conflict.id <> uf.id
              AND upload_conflict.case_id IS NOT DISTINCT FROM uf.case_id
              AND LOWER(COALESCE(upload_conflict.original_name, upload_conflict.file_name)) = LOWER(COALESCE(uf.original_name, uf.file_name))
          )
        )
      )
  )
  UPDATE ingestion_jobs ij
  SET file_id = ranked_matches.file_id
  FROM ranked_matches
  WHERE ij.id = ranked_matches.job_id
    AND ranked_matches.match_rank = 1
`;
