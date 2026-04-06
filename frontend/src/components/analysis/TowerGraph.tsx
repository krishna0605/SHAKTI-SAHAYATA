import React, { useEffect, useRef, useMemo } from 'react';
import { Network, DataSet } from 'vis-network/standalone';
import 'vis-network/styles/vis-network.css';
import type { NormalizedTowerDump } from '../utils/towerDumpNormalization';

const MAX_GRAPH_INPUT_RECORDS = 15000;
const MAX_GRAPH_NODES = 1200;
const MAX_GRAPH_EDGES = 2500;

interface TowerGraphProps {
  data: NormalizedTowerDump[];
  selectedTower?: string | null;
  onTowerSelect?: (cellId: string | null) => void;
  timeFilter?: {
    startDate?: string;
    endDate?: string;
  };
}

interface GraphNode {
  id: string;
  label: string;
  title: string;
  value: number;
  color?: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  value: number;
  title: string;
}

export const TowerGraph: React.FC<TowerGraphProps> = ({
  data,
  selectedTower,
  onTowerSelect,
  timeFilter
}) => {
  const networkRef = useRef<HTMLDivElement>(null);
  const networkInstance = useRef<Network | null>(null);

  // Filter data based on time
  const filteredData = useMemo(() => {
    let filtered = data;

    if (timeFilter?.startDate) {
      filtered = filtered.filter(record =>
        record.call_date && record.call_date >= timeFilter.startDate!
      );
    }

    if (timeFilter?.endDate) {
      filtered = filtered.filter(record =>
        record.call_date && record.call_date <= timeFilter.endDate!
      );
    }

    return filtered;
  }, [data, timeFilter]);

  // Build graph data
  const graphData = useMemo(() => {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const sourceRecords = filteredData.length > MAX_GRAPH_INPUT_RECORDS
      ? filteredData.slice(0, MAX_GRAPH_INPUT_RECORDS)
      : filteredData;

    sourceRecords.forEach(record => {
      // Add nodes for first and last cells
      if (record.first_cell_id) {
        if (!nodes.has(record.first_cell_id)) {
          nodes.set(record.first_cell_id, {
            id: record.first_cell_id,
            label: record.first_cell_id,
            title: `Cell ID: ${record.first_cell_id}\n${record.first_cell_desc || 'No description'}`,
            value: 0,
            color: selectedTower === record.first_cell_id ? '#1d4ed8' : '#60a5fa'
          });
        }
        nodes.get(record.first_cell_id)!.value++;
      }

      if (record.last_cell_id && record.last_cell_id !== record.first_cell_id) {
        if (!nodes.has(record.last_cell_id)) {
          nodes.set(record.last_cell_id, {
            id: record.last_cell_id,
            label: record.last_cell_id,
            title: `Cell ID: ${record.last_cell_id}\n${record.last_cell_desc || 'No description'}`,
            value: 0,
            color: selectedTower === record.last_cell_id ? '#1d4ed8' : '#60a5fa'
          });
        }
        nodes.get(record.last_cell_id)!.value++;
      }

      // Add edges for handovers
      if (record.first_cell_id && record.last_cell_id && record.first_cell_id !== record.last_cell_id) {
        const edgeKey = `${record.first_cell_id}-${record.last_cell_id}`;
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, {
            id: edgeKey,
            from: record.first_cell_id,
            to: record.last_cell_id,
            value: 0,
            title: `Handover: ${record.first_cell_id} → ${record.last_cell_id}`
          });
        }
        edges.get(edgeKey)!.value++;
      }
    });

    const nodeList = Array.from(nodes.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_GRAPH_NODES);
    const allowedNodeIds = new Set(nodeList.map((node) => node.id));
    const edgeList = Array.from(edges.values())
      .filter((edge) => allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to))
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_GRAPH_EDGES);

    return {
      nodes: nodeList,
      edges: edgeList,
      truncated: sourceRecords.length < filteredData.length || nodeList.length < nodes.size || edgeList.length < edges.size
    };
  }, [filteredData, selectedTower]);

  useEffect(() => {
    if (graphData.nodes.length > 0) return;
    if (networkInstance.current) {
      networkInstance.current.destroy();
      networkInstance.current = null;
    }
  }, [graphData]);

  // Initialize network
  useEffect(() => {
    if (!networkRef.current || graphData.nodes.length === 0) return;

    const nodes = new DataSet(graphData.nodes);
    const edges = new DataSet(graphData.edges);

    const options = {
      nodes: {
        shape: 'dot',
        scaling: {
          min: 10,
          max: 30,
          label: {
            enabled: true,
            min: 12,
            max: 24
          }
        },
        font: {
          size: 12,
          face: 'Arial'
        }
      },
      edges: {
        width: 1,
        scaling: {
          min: 1,
          max: 5
        },
        color: {
          color: '#2563eb',
          highlight: '#1d4ed8'
        }
      },
      physics: {
        enabled: graphData.nodes.length <= 500,
        barnesHut: {
          gravitationalConstant: -2000,
          centralGravity: 0.3,
          springLength: 95,
          springConstant: 0.04,
          damping: 0.09,
          avoidOverlap: 0.1
        },
        maxVelocity: 50,
        minVelocity: 0.1,
        solver: 'barnesHut' as const,
        stabilization: {
          enabled: true,
          iterations: 1000,
          updateInterval: 100,
          onlyDynamicEdges: false,
          fit: true
        }
      },
      interaction: {
        hover: true,
        tooltipDelay: 300,
        zoomView: true,
        dragView: true
      }
    };

    networkInstance.current = new Network(networkRef.current, { nodes, edges }, options);

    // Event handlers
    networkInstance.current.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        onTowerSelect?.(nodeId);
      } else {
        onTowerSelect?.(null);
      }
    });

    networkInstance.current.on('stabilizationIterationsDone', () => {
      networkInstance.current?.fit();
    });

    return () => {
      if (networkInstance.current) {
        networkInstance.current.destroy();
        networkInstance.current = null;
      }
    };
  }, [graphData, onTowerSelect]);

  // Update selected node color
  useEffect(() => {
    if (!networkInstance.current) return;

    // Reinitialize with updated colors
    const updatedNodes = graphData.nodes.map(node => ({
      ...node,
      color: selectedTower === node.id ? '#1d4ed8' : '#60a5fa'
    }));

    const nodes = new DataSet(updatedNodes);
    const edges = new DataSet(graphData.edges);

    networkInstance.current.setData({ nodes, edges });
  }, [selectedTower, graphData]);

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
        <div className="text-center">
          <span className="material-symbols-outlined text-6xl mb-4">hub</span>
          <h3 className="text-lg font-bold mb-2">No Tower Relationships Found</h3>
          <p>Records don't contain cell handover data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <div ref={networkRef} className="w-full h-full" />

      {/* Legend */}
      <div className="absolute top-4 right-4 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-lg backdrop-blur-xl z-[1000] dark:border-slate-800 dark:bg-[#111c38]/95">
        <h4 className="text-sm font-bold mb-2 text-slate-900 dark:text-white">Network Legend</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span className="text-slate-700 dark:text-slate-300">Tower Node</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-blue-600"></div>
            <span className="text-slate-700 dark:text-slate-300">Handover Connection</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-700 rounded-full"></div>
            <span className="text-slate-700 dark:text-slate-300">Selected Tower</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Node size indicates call volume
        </div>
        {graphData.truncated && (
          <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Large dataset detected. Graph is sampled for responsiveness.
          </div>
        )}
      </div>
    </div>
  );
};
