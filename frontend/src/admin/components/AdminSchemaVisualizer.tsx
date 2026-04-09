import { useEffect, useRef } from 'react'
import { DataSet, Network } from 'vis-network/standalone'
import 'vis-network/styles/vis-network.css'
import type { AdminDatabaseSchemaResponse } from '../types'

export default function AdminSchemaVisualizer({
  schema,
  selectedTable,
  onSelectTable,
  fitTrigger = 0,
}: {
  schema: AdminDatabaseSchemaResponse
  selectedTable: string | null
  onSelectTable: (tableName: string) => void
  fitTrigger?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const networkRef = useRef<Network | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const columnCount = Math.max(4, Math.ceil(Math.sqrt(schema.tables.length * 1.4)))

    const nodes = new DataSet<any>(
      schema.tables.map((table, index) => ({
        id: table.name,
        label: `${table.name}\n${table.estimatedRowCount.toLocaleString()} rows`,
        shape: 'box',
        margin: { top: 14, right: 14, bottom: 14, left: 14 },
        widthConstraint: { minimum: 180, maximum: 220 },
        font: {
          color: '#e5eefb',
          face: 'Geist Variable',
          multi: true,
          size: 14,
        },
        color: {
          background: selectedTable === table.name ? '#183d75' : '#10192b',
          border: selectedTable === table.name ? '#5ea0ff' : '#2b394c',
          highlight: {
            background: '#183d75',
            border: '#8bc4ff',
          },
        },
        x: (index % columnCount) * 230,
        y: Math.floor(index / columnCount) * 150,
      })),
    )

    const edges = new DataSet<any>(
      schema.relationships.map((relationship) => ({
        id: relationship.constraintName,
        from: relationship.sourceTable,
        to: relationship.targetTable,
        arrows: 'to',
        color: selectedTable && (relationship.sourceTable === selectedTable || relationship.targetTable === selectedTable)
          ? { color: '#7fd0ff', highlight: '#a7dcff' }
          : { color: 'rgba(119, 131, 154, 0.45)', highlight: '#7fd0ff' },
        smooth: {
          enabled: true,
          type: 'cubicBezier',
          forceDirection: 'horizontal',
          roundness: 0.35,
        },
      })),
    )

    const network = new Network(
      containerRef.current,
      { nodes, edges },
      {
        autoResize: true,
        interaction: {
          hover: true,
          tooltipDelay: 200,
          dragView: true,
          zoomView: true,
        },
        physics: false,
        layout: {
          improvedLayout: true,
        },
        nodes: {
          borderWidth: 1,
          borderWidthSelected: 2,
        },
        edges: {
          width: 1,
          selectionWidth: 2,
        },
      },
    )

    network.moveTo({
      position: { x: ((columnCount - 1) * 230) / 2, y: (Math.floor(schema.tables.length / columnCount) * 150) / 2 },
      scale: 0.95,
      animation: false,
    })

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        onSelectTable(String(params.nodes[0]))
      }
    })

    networkRef.current = network

    return () => {
      network.destroy()
      networkRef.current = null
    }
  }, [onSelectTable, schema.relationships, schema.tables, selectedTable])

  useEffect(() => {
    if (!networkRef.current) return
    networkRef.current.fit({ animation: { duration: 250, easingFunction: 'easeInOutQuad' } })
  }, [fitTrigger])

  return <div ref={containerRef} className="h-[680px] rounded-lg border border-white/8 bg-[#0b0e14]" />
}
