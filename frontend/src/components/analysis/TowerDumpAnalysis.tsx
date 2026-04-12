import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { NormalizedTowerDump } from '../utils/towerDumpNormalization';
import { towerDumpAPI } from '../lib/apis';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TowerMap } from './TowerMap';
import { TowerGraph } from './TowerGraph';
import * as XLSX from 'xlsx-js-style';
import { encodeSpreadsheetRows } from '../lib/security';
import { RecordTable } from './RecordTable';
import { AnalysisTabBar } from './AnalysisTabBar';
import { usePaginatedAnalysisRecords } from './usePaginatedAnalysisRecords';
import { useChatbotWorkspaceStore } from '../../stores/chatbotWorkspaceStore';
import { getMetricUiLabel } from '../../lib/caseQaCatalog';
import { Network, DataSet } from 'vis-network/standalone';
import 'vis-network/styles/vis-network.css';
import { markPerformanceEvent, trackPerformanceAsync } from '../../lib/performance';

interface TowerDumpAnalysisProps {
  caseId?: string;
  caseName: string;
  operator: string;
  data?: NormalizedTowerDump[];
  fileCount: number;
  onBack?: () => void;
}

interface TowerDumpStats {
  totalRecords: number;
  uniqueAParties: number;
  uniqueBParties: number;
  callTypes: Record<string, number>;
  avgDuration: number;
  allIMEIsWithCounts: Array<[string, number]>;
  allIMSIsWithCounts: Array<[string, number]>;
  commonCallers: Array<[string, number]>;
  otherStateSummary: {
    count: number;
    uniqueCallers: number;
    avgDuration: number;
  };
  roamingCircleSummary: Array<{ name: string; value: number }>;
  roamingCircleData: Array<{ name: string; value: number }>;
}

type SheetRow = Record<string, string | number | null | undefined>;

interface PartyGraphNode {
  id: string;
  label: string;
  title: string;
  value: number;
  color?: string;
  borderWidth?: number;
  x?: number;
  y?: number;
}

interface PartyGraphEdge {
  id: string;
  from: string;
  to: string;
  value: number;
  title: string;
  color?: string | { color?: string; highlight?: string };
  width?: number;
  opacity?: number;
}
type PartyGraphNodeUpdate = Pick<PartyGraphNode, 'id'> & Partial<PartyGraphNode>;
type PartyGraphEdgeUpdate = Pick<PartyGraphEdge, 'id'> & Partial<PartyGraphEdge>;

interface PartyNetworkGraphProps {
  caseId?: string;
  data: NormalizedTowerDump[];
  selectedNode?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  viewMode?: 'cluster' | 'binary';
  timeFilter?: {
    startDate?: string;
    endDate?: string;
  };
}

const PARTY_GRAPH_BUILD_CHUNK_SIZE = 1500;
const PARTY_GRAPH_RENDER_NODE_CHUNK = 250;
const PARTY_GRAPH_RENDER_EDGE_CHUNK = 500;
const PARTY_NODE_PATH_COLOR = '#f59e0b';
const PARTY_NODE_SELECTED_COLOR = '#ef4444';
const PARTY_EDGE_DEFAULT_DIM = '#334155';
const PARTY_EDGE_PATH_COLOR = '#f97316';
const MAX_PATH_HIGHLIGHT_NODES = 1200;
const MAX_PATH_HIGHLIGHT_EDGES = 1800;
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const normalizeNumber = (value?: string | number | null) => {
  if (value === null || value === undefined) return '';
  let raw = '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    raw = Math.round(value).toString();
  } else {
    raw = String(value).trim();
    if (!raw) return '';
    if (/^\d+\.?\d*e[+-]\d+$/i.test(raw)) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        raw = Math.round(parsed).toString();
      }
    }
  }
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('91') && digits.length >= 12) digits = digits.slice(-10);
  if (digits.startsWith('0') && digits.length >= 11) digits = digits.slice(-10);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits.length === 10 ? digits : '';
};

const normalizeBParty = (value?: string | number | null) => {
  const digits = normalizeNumber(value);
  if (!digits) return '';
  return /^[6-9]\d{9}$/.test(digits) ? digits : '';
};

const projectBinaryTreeGraph = (
  nodes: PartyGraphNode[],
  edges: PartyGraphEdge[],
  preferredRoot?: string | null
) => {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, Array<{ to: string; value: number; edge: PartyGraphEdge }>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)!.push({ to: edge.to, value: edge.value, edge });
    adjacency.get(edge.to)!.push({ to: edge.from, value: edge.value, edge });
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => b.value - a.value || a.to.localeCompare(b.to));
  }

  const root =
    (preferredRoot && nodeMap.has(preferredRoot) ? preferredRoot : null) ||
    [...nodes].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0]?.id;
  if (!root) return { nodes: [], edges: [] };

  const depth = new Map<string, number>([[root, 0]]);
  const visited = new Set<string>([root]);
  const branchSign = new Map<string, number>([[root, 0]]);
  const treeEdgeIds = new Set<string>();
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current) ?? 0;
    const candidates = adjacency.get(current) || [];
    let branchToggle = 0;

    for (const candidate of candidates) {
      if (visited.has(candidate.to)) continue;
      visited.add(candidate.to);
      depth.set(candidate.to, currentDepth + 1);
      queue.push(candidate.to);
      treeEdgeIds.add(candidate.edge.id);
      if (current === root) {
        branchSign.set(candidate.to, branchToggle % 2 === 0 ? -1 : 1);
      } else {
        const inherited = branchSign.get(current) || 1;
        branchSign.set(candidate.to, inherited);
      }
      branchToggle += 1;
    }
  }

  // Include disconnected components too so full dataset is always represented.
  let componentIndex = 0;
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    componentIndex += 1;
    visited.add(node.id);
    depth.set(node.id, 1 + componentIndex * 2);
    branchSign.set(node.id, componentIndex % 2 === 0 ? 1 : -1);
    const localQueue: string[] = [node.id];
    while (localQueue.length > 0) {
      const current = localQueue.shift()!;
      const candidates = adjacency.get(current) || [];
      for (const candidate of candidates) {
        if (visited.has(candidate.to)) continue;
        visited.add(candidate.to);
        depth.set(candidate.to, (depth.get(current) ?? 0) + 1);
        branchSign.set(candidate.to, branchSign.get(current) || 1);
        treeEdgeIds.add(candidate.edge.id);
        localQueue.push(candidate.to);
      }
    }
  }

  const orderedNodes = Array.from(visited)
    .map((id) => nodeMap.get(id))
    .filter((node): node is PartyGraphNode => Boolean(node));
  const bucket = new Map<string, PartyGraphNode[]>();
  for (const node of orderedNodes) {
    const d = depth.get(node.id) ?? 0;
    const sign = branchSign.get(node.id) ?? 1;
    const key = `${d}:${sign}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(node);
  }

  const positionedNodes: PartyGraphNode[] = [];
  for (const node of orderedNodes) {
    const d = depth.get(node.id) ?? 0;
    const sign = branchSign.get(node.id) ?? 1;
    const key = `${d}:${sign}`;
    const cluster = (bucket.get(key) || []).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    const index = cluster.findIndex((n) => n.id === node.id);
    const center = (cluster.length - 1) / 2;
    const rowSpacing = d <= 1 ? 72 : d <= 3 ? 62 : 54;
    const spread = (index - center) * rowSpacing;

    const x = d * 170 + (sign === 0 ? 0 : (d > 1 ? 24 * sign : 0));
    const y = d === 0 ? 0 : sign * (88 + d * 6) + spread;
    const color = d === 0 ? '#00A99D' : d <= 2 ? '#FFDC1C' : '#FFF3B8';
    const sizedValue =
      d === 0 ? Math.max(node.value, 24) : d <= 2 ? Math.max(12, node.value * 0.72) : Math.max(7, node.value * 0.34);

    positionedNodes.push({
      ...node,
      color,
      value: sizedValue,
      x,
      y
    });
  }

  const styledEdges = edges.map((edge) => ({
    ...edge,
    color: treeEdgeIds.has(edge.id)
      ? { color: '#cbd5e1', highlight: PARTY_EDGE_PATH_COLOR }
      : { color: '#e5e7eb', highlight: PARTY_EDGE_PATH_COLOR },
    width: treeEdgeIds.has(edge.id) ? 1.4 : 0.8
  }));

  return {
    nodes: positionedNodes,
    edges: styledEdges
  };
};

const PartyNetworkGraph: React.FC<PartyNetworkGraphProps> = ({ caseId, data, selectedNode, onNodeSelect, viewMode = 'cluster', timeFilter }) => {
  const networkRef = useRef<HTMLDivElement>(null);
  const networkInstance = useRef<Network | null>(null);
  const nodesDataSetRef = useRef<DataSet<PartyGraphNode> | null>(null);
  const edgesDataSetRef = useRef<DataSet<PartyGraphEdge> | null>(null);
  const renderTokenRef = useRef(0);
  const [rawGraphData, setRawGraphData] = useState<{ nodes: PartyGraphNode[]; edges: PartyGraphEdge[]; truncated: boolean }>({
    nodes: [],
    edges: [],
    truncated: false
  });
  const [isBuildingGraph, setIsBuildingGraph] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [isRenderingGraph, setIsRenderingGraph] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedCounts, setRenderedCounts] = useState({ nodes: 0, edges: 0 });
  const [nodeSearchQuery, setNodeSearchQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const [isDraggingGraph, setIsDraggingGraph] = useState(false);

  const filteredData = useMemo(() => {
    let filtered = data;
    if (timeFilter?.startDate) {
      filtered = filtered.filter(record => record.call_date && record.call_date >= timeFilter.startDate!);
    }
    if (timeFilter?.endDate) {
      filtered = filtered.filter(record => record.call_date && record.call_date <= timeFilter.endDate!);
    }
    return filtered;
  }, [data, timeFilter]);

  useEffect(() => {
    let cancelled = false;

    const buildGraphInChunks = async () => {
      setIsBuildingGraph(true);
      setBuildProgress(0);

      if (caseId) {
        try {
          startTransition(() => setBuildProgress(10));
          const graph = await towerDumpAPI.getPartyGraph(caseId, {
            startDate: timeFilter?.startDate,
            endDate: timeFilter?.endDate
          }) as { nodes?: PartyGraphNode[]; edges?: PartyGraphEdge[] };
          if (cancelled) return;
          startTransition(() => {
            setBuildProgress(90);
            setRawGraphData({
              nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
              edges: Array.isArray(graph.edges) ? graph.edges : [],
              truncated: false
            });
            setBuildProgress(100);
            setIsBuildingGraph(false);
          });
          return;
        } catch {
          // Fallback to local chunk build when DB aggregation endpoint is unavailable.
        }
      }

      const nodes = new Map<string, PartyGraphNode>();
      const edges = new Map<string, PartyGraphEdge>();
      const total = filteredData.length;

      if (total === 0) {
        if (!cancelled) {
          startTransition(() => {
            setRawGraphData({ nodes: [], edges: [], truncated: false });
            setBuildProgress(100);
            setIsBuildingGraph(false);
          });
        }
        return;
      }

      for (let i = 0; i < total; i += 1) {
        const record = filteredData[i];
        const source = normalizeNumber(record.a_party);
        const target = normalizeBParty(record.b_party);
        if (source && target) {
          const edgeKey = `${source}-${target}`;
          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, {
              id: edgeKey,
              from: source,
              to: target,
              value: 0,
              title: `${source} → ${target}`
            });
          }
          edges.get(edgeKey)!.value++;

          if (!nodes.has(source)) {
            nodes.set(source, {
              id: source,
              label: source,
              title: `Target: ${source}`,
              value: 0,
              color: '#3b82f6'
            });
          }
          if (!nodes.has(target)) {
            nodes.set(target, {
              id: target,
              label: target,
              title: `B Party: ${target}`,
              value: 0,
              color: '#f97316'
            });
          }
          nodes.get(source)!.value++;
          nodes.get(target)!.value++;
        }

        if ((i + 1) % PARTY_GRAPH_BUILD_CHUNK_SIZE === 0 || i === total - 1) {
          if (cancelled) return;
          const progress = Math.min(100, Math.round(((i + 1) / total) * 100));
          startTransition(() => setBuildProgress(progress));
          await yieldToUI();
        }
      }

      if (cancelled) return;

      startTransition(() => {
        setRawGraphData({
          nodes: Array.from(nodes.values()),
          edges: Array.from(edges.values()),
          truncated: false
        });
        setBuildProgress(100);
        setIsBuildingGraph(false);
      });
    };

    void buildGraphInChunks();

    return () => {
      cancelled = true;
    };
  }, [caseId, filteredData, timeFilter?.endDate, timeFilter?.startDate]);

  const graphData = useMemo(() => ({
    nodes: rawGraphData.nodes,
    edges: rawGraphData.edges,
    truncated: rawGraphData.truncated
  }), [rawGraphData]);
  const isBinaryMode = viewMode === 'binary';
  const visualGraphData = useMemo(() => {
    if (!isBinaryMode) {
      return {
        nodes: graphData.nodes,
        edges: graphData.edges
      };
    }
    return projectBinaryTreeGraph(graphData.nodes, graphData.edges);
  }, [graphData.edges, graphData.nodes, isBinaryMode]);

  const nodeLookup = useMemo(
    () => new Map(visualGraphData.nodes.map((node) => [node.id, node])),
    [visualGraphData.nodes]
  );
  const edgeLookup = useMemo(
    () => new Map(visualGraphData.edges.map((edge) => [edge.id, edge])),
    [visualGraphData.edges]
  );
  const adjacencyByNode = useMemo(() => {
    const adjacency = new Map<string, Array<{ edgeId: string; neighbor: string }>>();
    for (const edge of visualGraphData.edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from)!.push({ edgeId: edge.id, neighbor: edge.to });
      adjacency.get(edge.to)!.push({ edgeId: edge.id, neighbor: edge.from });
    }
    return adjacency;
  }, [visualGraphData.edges]);
  const highlightedNodeIdsRef = useRef<Set<string>>(new Set());
  const highlightedEdgeIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const container = networkRef.current;
    if (!container) return;
    if (visualGraphData.nodes.length === 0) return;

    const nodes = new DataSet<PartyGraphNode>([]);
    const edges = new DataSet<PartyGraphEdge>([]);
    nodesDataSetRef.current = nodes;
    edgesDataSetRef.current = edges;
    highlightedNodeIdsRef.current = new Set();
    highlightedEdgeIdsRef.current = new Set();
    setRenderProgress(0);
    setRenderedCounts({ nodes: 0, edges: 0 });
    setSearchMessage('');

    const options = {
      nodes: {
        shape: 'dot',
        scaling: {
          min: 10,
          max: 30,
          label: {
            enabled: visualGraphData.nodes.length <= 1500,
            min: 12,
            max: 22
          }
        },
        font: {
          size: visualGraphData.nodes.length <= 1500 ? 12 : 0,
          face: 'Arial'
        }
      },
      edges: {
        width: 1,
        scaling: {
          min: 1,
          max: 6
        },
        color: {
          color: isBinaryMode ? '#d1d5db' : PARTY_EDGE_DEFAULT_DIM,
          highlight: PARTY_EDGE_PATH_COLOR
        },
        smooth: isBinaryMode
          ? {
              enabled: true,
              type: 'cubicBezier' as const,
              roundness: 0.35
            }
          : false,
        arrows: { to: { enabled: true, scaleFactor: 0.6 } }
      },
      layout: isBinaryMode
        ? {
            hierarchical: {
              enabled: false
            }
          }
        : {
            hierarchical: {
              enabled: false
            }
          },
      physics: isBinaryMode
        ? {
            enabled: true,
            barnesHut: {
              gravitationalConstant: -3400,
              centralGravity: 0.05,
              springLength: 135,
              springConstant: 0.03,
              damping: 0.16,
              avoidOverlap: 0.38
            },
            maxVelocity: 50,
            minVelocity: 0.1,
            solver: 'barnesHut' as const,
            stabilization: {
              enabled: true,
              iterations: 1200,
              updateInterval: 100,
              onlyDynamicEdges: false,
              fit: true
            }
          }
        : {
            enabled: true,
            barnesHut: {
              gravitationalConstant: -5600,
              centralGravity: 0.05,
              springLength: 240,
              springConstant: 0.03,
              damping: 0.14,
              avoidOverlap: 0.45
            },
            maxVelocity: 50,
            minVelocity: 0.1,
            solver: 'barnesHut' as const,
            stabilization: {
              enabled: true,
              iterations: 2400,
              updateInterval: 100,
              onlyDynamicEdges: false,
              fit: true
            }
          },
      interaction: {
        hover: false,
        tooltipDelay: 120,
        zoomView: true,
        dragView: true,
        hideEdgesOnDrag: true,
        hideEdgesOnZoom: true
      }
    };

    networkInstance.current = new Network(container, { nodes, edges }, options);

    networkInstance.current.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = String(params.nodes[0]);
        onNodeSelect?.(nodeId);
        setSearchMessage('');
      } else {
        onNodeSelect?.(null);
      }
    });

    networkInstance.current.on('stabilizationIterationsDone', () => {
      if (isBinaryMode) {
        networkInstance.current?.fit();
        networkInstance.current?.setOptions({ physics: { enabled: false } });
      }
    });

    networkInstance.current.on('dragStart', () => {
      setIsDraggingGraph(true);
    });
    networkInstance.current.on('dragEnd', () => {
      setIsDraggingGraph(false);
    });

    if (isBinaryMode) {
      // Fit immediately for hierarchical layout when physics is disabled.
      networkInstance.current.fit();
    }

    const token = renderTokenRef.current + 1;
    renderTokenRef.current = token;

    const renderDataInChunks = async () => {
      setIsRenderingGraph(true);

      const totalNodes = visualGraphData.nodes.length;
      const totalEdges = visualGraphData.edges.length;
      let renderedNodes = 0;
      let renderedEdges = 0;

      for (let i = 0; i < totalNodes; i += PARTY_GRAPH_RENDER_NODE_CHUNK) {
        if (renderTokenRef.current !== token) return;
        const chunk = visualGraphData.nodes.slice(i, i + PARTY_GRAPH_RENDER_NODE_CHUNK);
        nodes.add(chunk);
        renderedNodes += chunk.length;
        startTransition(() => {
          setRenderedCounts((prev) => ({ ...prev, nodes: renderedNodes }));
          const progress = Math.round(((renderedNodes + renderedEdges) / Math.max(totalNodes + totalEdges, 1)) * 100);
          setRenderProgress(progress);
        });
        await yieldToUI();
      }

      for (let i = 0; i < totalEdges; i += PARTY_GRAPH_RENDER_EDGE_CHUNK) {
        if (renderTokenRef.current !== token) return;
        const chunk = visualGraphData.edges.slice(i, i + PARTY_GRAPH_RENDER_EDGE_CHUNK);
        edges.add(chunk);
        renderedEdges += chunk.length;
        startTransition(() => {
          setRenderedCounts((prev) => ({ ...prev, edges: renderedEdges }));
          const progress = Math.round(((renderedNodes + renderedEdges) / Math.max(totalNodes + totalEdges, 1)) * 100);
          setRenderProgress(progress);
        });
        await yieldToUI();
      }

      if (renderTokenRef.current !== token) return;
      startTransition(() => {
        setRenderProgress(100);
        setIsRenderingGraph(false);
      });

      if (!isBinaryMode) {
        // Stop simulation immediately after chunk render to avoid long main-thread stalls.
        networkInstance.current?.stopSimulation();
        networkInstance.current?.setOptions({ physics: { enabled: false } });
      }
    };

    void renderDataInChunks();

    return () => {
      renderTokenRef.current += 1;
      setIsRenderingGraph(false);
      if (networkInstance.current) {
        networkInstance.current.destroy();
        networkInstance.current = null;
      }
      nodesDataSetRef.current = null;
      edgesDataSetRef.current = null;
      setIsDraggingGraph(false);
    };
  }, [isBinaryMode, onNodeSelect, visualGraphData]);

  useEffect(() => {
    const nodeSet = nodesDataSetRef.current;
    const edgeSet = edgesDataSetRef.current;
    if (!nodeSet || !edgeSet) return;

    const previouslyHighlightedNodes = highlightedNodeIdsRef.current;
    const previouslyHighlightedEdges = highlightedEdgeIdsRef.current;
    if (previouslyHighlightedNodes.size > 0) {
      const resetNodes: PartyGraphNodeUpdate[] = [];
      for (const nodeId of previouslyHighlightedNodes) {
        if (!nodeSet.get(nodeId)) continue;
        const original = nodeLookup.get(nodeId);
        if (!original) continue;
        resetNodes.push({
          id: nodeId,
          color: original.color,
          borderWidth: 1
        });
      }
      if (resetNodes.length > 0) nodeSet.update(resetNodes);
      highlightedNodeIdsRef.current = new Set();
    }
    if (previouslyHighlightedEdges.size > 0) {
      const resetEdges: PartyGraphEdgeUpdate[] = [];
      for (const edgeId of previouslyHighlightedEdges) {
        if (!edgeSet.get(edgeId)) continue;
        resetEdges.push({
          id: edgeId,
          color: PARTY_EDGE_DEFAULT_DIM,
          width: 1
        });
      }
      if (resetEdges.length > 0) edgeSet.update(resetEdges);
      highlightedEdgeIdsRef.current = new Set();
    }

    if (!selectedNode || !nodeLookup.has(selectedNode)) {
      return;
    }

    const visitedNodes = new Set<string>([selectedNode]);
    const visitedEdges = new Set<string>();
    const queue: string[] = [selectedNode];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacencyByNode.get(current) || [];
      for (const { edgeId, neighbor } of neighbors) {
        if (edgeLookup.has(edgeId) && visitedEdges.size < MAX_PATH_HIGHLIGHT_EDGES) visitedEdges.add(edgeId);
        if (visitedNodes.has(neighbor)) continue;
        if (visitedNodes.size >= MAX_PATH_HIGHLIGHT_NODES) continue;
        visitedNodes.add(neighbor);
        queue.push(neighbor);
      }
      if (visitedNodes.size >= MAX_PATH_HIGHLIGHT_NODES && visitedEdges.size >= MAX_PATH_HIGHLIGHT_EDGES) break;
    }

    const pathNodeUpdates: PartyGraphNodeUpdate[] = [];
    for (const nodeId of visitedNodes) {
      if (!nodeSet.get(nodeId)) continue;
      pathNodeUpdates.push({
        id: nodeId,
        color: nodeId === selectedNode ? PARTY_NODE_SELECTED_COLOR : PARTY_NODE_PATH_COLOR,
        borderWidth: nodeId === selectedNode ? 4 : 2
      });
    }
    if (pathNodeUpdates.length > 0) nodeSet.update(pathNodeUpdates);

    const pathEdgeUpdates: PartyGraphEdgeUpdate[] = [];
    for (const edgeId of visitedEdges) {
      if (!edgeSet.get(edgeId)) continue;
      pathEdgeUpdates.push({
        id: edgeId,
        color: PARTY_EDGE_PATH_COLOR,
        width: 3
      });
    }
    if (pathEdgeUpdates.length > 0) edgeSet.update(pathEdgeUpdates);

    highlightedNodeIdsRef.current = visitedNodes;
    highlightedEdgeIdsRef.current = visitedEdges;
  }, [adjacencyByNode, edgeLookup, nodeLookup, selectedNode]);

  const handleSearchNode = useCallback(() => {
    const query = nodeSearchQuery.trim();
    if (!query) {
      setSearchMessage('Enter a number to search');
      return;
    }

    const normalized = normalizeNumber(query);
    const needle = normalized || query;
    const exactMatch = nodeLookup.get(needle);
    const partialMatch = exactMatch
      ? null
      : visualGraphData.nodes.find((node) => node.id.includes(needle) || node.label.includes(needle));
    const match = exactMatch || partialMatch;
    if (!match) {
      setSearchMessage('Node not found');
      return;
    }

    if (!nodesDataSetRef.current?.get(match.id)) {
      setSearchMessage('Node exists but is still loading. Wait a moment and retry.');
      return;
    }

    setSearchMessage(`Focused node: ${match.id}`);
    onNodeSelect?.(match.id);
    networkInstance.current?.selectNodes([match.id]);
    networkInstance.current?.focus(match.id, {
      scale: 1.25,
      animation: {
        duration: 500,
        easingFunction: 'easeInOutQuad'
      }
    });
  }, [nodeLookup, nodeSearchQuery, onNodeSelect, visualGraphData.nodes]);

  if (visualGraphData.nodes.length === 0 && !isBuildingGraph) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
        <div className="text-center">
          <span className="material-symbols-outlined text-6xl mb-4">hub</span>
          <h3 className="text-lg font-bold mb-2">No Party Relationships Found</h3>
          <p>Records don't contain valid Target/B Party numbers</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <div
        ref={networkRef}
        className={`w-full h-full ${isDraggingGraph ? 'cursor-grabbing' : 'cursor-grab'}`}
      />
      {isBuildingGraph && (
        <div className="pointer-events-none absolute top-4 left-4 z-[1001]">
          <div className="min-w-[260px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Building party graph...</div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Processing records in chunks</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-blue-600 transition-all duration-200" style={{ width: `${buildProgress}%` }} />
              </div>
              <div className="mt-1 text-right text-xs text-slate-600 dark:text-slate-300">{buildProgress}%</div>
            </div>
          </div>
        </div>
      )}
      <div className="absolute top-4 right-4 bg-white dark:bg-slate-800 p-3 rounded-lg shadow-lg z-[1000]">
        <h4 className="text-sm font-bold mb-2 text-slate-900 dark:text-white">Network Legend</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span className="text-slate-700 dark:text-slate-300">Target Number</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
            <span className="text-slate-700 dark:text-slate-300">B Party Number</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <span className="text-slate-700 dark:text-slate-300">Selected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-green-500"></div>
            <span className="text-slate-700 dark:text-slate-300">Calls</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Node size indicates frequency
        </div>
        {!isBinaryMode && (
          <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
            Cluster mode: full graph rendered as connected web.
          </div>
        )}
        {isBinaryMode && (
          <div className="mt-2 text-xs text-blue-700 dark:text-blue-300">
            Binary-inspired mode: full dataset rendered with dual-branch core and clustered satellites.
          </div>
        )}
        {isBuildingGraph && (
          <div className="mt-2 text-xs text-blue-700 dark:text-blue-300">
            Rendering in chunks... {buildProgress}%
          </div>
        )}
        {isRenderingGraph && (
          <div className="mt-2 text-xs text-indigo-700 dark:text-indigo-300">
            Drawing graph in chunks... {renderProgress}% ({renderedCounts.nodes}/{visualGraphData.nodes.length} nodes, {renderedCounts.edges}/{visualGraphData.edges.length} links)
          </div>
        )}
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold text-slate-900 dark:text-white">Find Node</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={nodeSearchQuery}
              onChange={(e) => setNodeSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearchNode();
                }
              }}
              placeholder="Enter phone number"
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs px-2 py-1"
            />
            <button
              type="button"
              onClick={handleSearchNode}
              className="rounded bg-blue-600 text-white text-xs px-2 py-1 hover:bg-blue-700"
            >
              Search
            </button>
          </div>
          {searchMessage && (
            <div className="text-xs text-slate-600 dark:text-slate-300">{searchMessage}</div>
          )}
        </div>
        {!isBuildingGraph && (
          <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            Visualized nodes: {renderedCounts.nodes}/{visualGraphData.nodes.length} | links: {renderedCounts.edges}/{visualGraphData.edges.length}
          </div>
        )}
      </div>
    </div>
  );
};

const applyHeaderStylesAndFilter = (ws: XLSX.WorkSheet, headers: string[], headerColor = 'FF2563EB') => {
  const ref = ws['!ref'] || XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(headers.length - 1, 0) } });
  const range = XLSX.utils.decode_range(ref);
  range.e.c = Math.max(range.e.c, headers.length - 1);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };

  headers.forEach((_, col) => {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    const cell = ws[cellAddress];
    if (!cell) return;
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: headerColor } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };
  });

  for (let row = 1; row <= range.e.r; row += 1) {
    const fillColor = row % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
    for (let col = 0; col <= range.e.c; col += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellAddress];
      if (!cell) continue;
      cell.s = {
        ...(cell.s || {}),
        fill: { patternType: 'solid', fgColor: { rgb: fillColor } }
      };
    }
  }
};

type SheetMeta = XLSX.SheetProps & { TabColor?: { rgb: string } };

const applySheetTabColor = (workbook: XLSX.WorkBook, sheetName: string, color: string) => {
  if (!workbook.Workbook) workbook.Workbook = { Sheets: [] };
  if (!workbook.Workbook.Sheets) workbook.Workbook.Sheets = [];
  const sheets = workbook.Workbook.Sheets as SheetMeta[];
  const existing = sheets.find(entry => entry.name === sheetName);
  if (existing) {
    existing.TabColor = { rgb: color };
    return;
  }
  sheets.push({ name: sheetName, TabColor: { rgb: color } });
};

export const TowerDumpAnalysis: React.FC<TowerDumpAnalysisProps> = ({
  caseId,
  caseName,
  operator,
  data: initialData,
  fileCount,
  onBack
}) => {
  const setWorkspaceContext = useChatbotWorkspaceStore((state) => state.setWorkspaceContext);
  const clearWorkspaceContext = useChatbotWorkspaceStore((state) => state.clearWorkspaceContext);
  const [data, setData] = useState<NormalizedTowerDump[]>(initialData || []);
  const [loading, setLoading] = useState(!initialData && !!caseId);
  const [summary, setSummary] = useState<{
    totalRecords?: number;
    uniqueAParties?: number;
    uniqueBParties?: number;
    avgDurationSec?: number;
    callTypes?: Array<{ label: string; value: number }>;
    topParties?: Array<{ label: string; value: number }>;
  } | null>(null);

  const [selectedTab, setSelectedTab] = useState<'overview' | 'records' | 'map' | 'graph' | 'party_graph' | 'charts'>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [currentTime, setCurrentTime] = useState(new Date());
  const fileCountState = fileCount;
  const [isExporting, setIsExporting] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Filter state
  const [callTypeFilter, setCallTypeFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [durationMinFilter, setDurationMinFilter] = useState('');
  const [durationMaxFilter, setDurationMaxFilter] = useState('');
  const [filterOptions, setFilterOptions] = useState<{ callTypes: string[] }>({ callTypes: [] });

  // Map-specific state
  const [selectedTower, setSelectedTower] = useState<string | null>(null);
  const [mapTimeFilter, setMapTimeFilter] = useState<{ startDate?: string; endDate?: string }>({});
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [partyGraphTimeFilter, setPartyGraphTimeFilter] = useState<{ startDate?: string; endDate?: string }>({});
  const [partyGraphViewMode, setPartyGraphViewMode] = useState<'cluster' | 'binary'>('cluster');
  const [isPartyGraphFullscreen, setIsPartyGraphFullscreen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    markPerformanceEvent('tower.route-entered', { caseId: caseId || null });
  }, [caseId]);

  useEffect(() => {
    markPerformanceEvent('tower.shell-rendered', { caseId: caseId || null });
  }, [caseId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPartyGraphFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const records = await towerDumpAPI.getRecordsByCase(caseId!) as NormalizedTowerDump[];
      
      // Validate and clean the data
      const getRecordKey = (record: NormalizedTowerDump, index: number) => {
        if (record.record_id) return `rid:${record.record_id}`;
        const meta = record as NormalizedTowerDump & { source_file?: string; row_index?: number; _source_file?: string; _row_index?: number };
        const sourceFile = meta.source_file || meta._source_file;
        const rowIndex = meta.row_index ?? meta._row_index;
        if (sourceFile && rowIndex !== undefined && rowIndex !== null) return `file:${sourceFile}#${rowIndex}`;
        const fallback = [
          record.a_party || '',
          record.b_party || '',
          record.call_date || '',
          record.call_start_time || '',
          record.call_end_time || '',
          record.first_cell_id || '',
          record.last_cell_id || '',
          String(record.duration_sec ?? ''),
          record.imei || '',
          record.imsi || ''
        ].join('|');
        return `fallback:${fallback}:${index}`;
      };
      const seenKeys = new Set<string>();
      const uniqueRecords: NormalizedTowerDump[] = [];
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const key = getRecordKey(record, index);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        uniqueRecords.push(record);
      }
      
      // Remove the filtering to show all original records
      const parsedData = uniqueRecords.map((record: NormalizedTowerDump) => ({
        ...record,
        operator: record.operator || operator,
      }));
      startTransition(() => {
        setData(parsedData);
      });
    } catch (error) {
      console.error('[TowerDumpAnalysis] Failed to fetch tower dump data:', error);
      // Set empty data on error
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [caseId, operator]);

  const loadSummary = useCallback(async () => {
    if (!caseId) return;
    try {
      const nextSummary = await trackPerformanceAsync(
        'tower.summary.load',
        () => towerDumpAPI.getSummary(caseId),
        { caseId }
      );
      setSummary((nextSummary && typeof nextSummary === 'object') ? nextSummary as typeof summary : null);
    } catch (error) {
      console.error('[TowerDumpAnalysis] Failed to load tower dump summary:', error);
    }
  }, [caseId]);

  const loadRecordFilters = useCallback(async () => {
    if (!caseId) return;
    try {
      const nextFilters = await towerDumpAPI.getFilters(caseId) as { callTypes?: string[] };
      setFilterOptions({
        callTypes: Array.isArray(nextFilters?.callTypes) ? nextFilters.callTypes : []
      });
    } catch (error) {
      console.error('[TowerDumpAnalysis] Failed to load tower dump filters:', error);
      setFilterOptions({ callTypes: [] });
    }
  }, [caseId]);

  useEffect(() => {
    if (caseId && !initialData) {
      fetchData();
    }
  }, [caseId, fetchData, initialData]);

  useEffect(() => {
    if (!caseId) {
      setSummary(null);
      setFilterOptions({ callTypes: [] });
      return;
    }
    loadSummary();
    loadRecordFilters();
  }, [caseId, loadSummary, loadRecordFilters]);

  useEffect(() => {
    if (summary) {
      markPerformanceEvent('tower.summary.loaded', {
        caseId: caseId || null,
        totalRecords: Number(summary.totalRecords || 0)
      });
    }
  }, [caseId, summary]);

  const filteredData = useMemo(() => {
    if (selectedTab !== 'records') return data;

    const hasFilters = Boolean(
      deferredSearchTerm ||
      callTypeFilter ||
      dateFromFilter ||
      dateToFilter ||
      durationMinFilter ||
      durationMaxFilter
    );
    if (!hasFilters) return data;

    let filtered = data;
    const searchLower = deferredSearchTerm.toLowerCase();

    if (deferredSearchTerm) {
      filtered = filtered.filter(record =>
        record.a_party?.includes(deferredSearchTerm) ||
        record.b_party?.includes(deferredSearchTerm) ||
        record.first_cell_id?.includes(deferredSearchTerm) ||
        record.last_cell_id?.includes(deferredSearchTerm) ||
        record.call_type?.toLowerCase().includes(searchLower) ||
        displayIMEI(record.imei).includes(deferredSearchTerm) ||
        displayIMSI(record.imsi).includes(deferredSearchTerm)
      );
    }

    if (callTypeFilter) {
      const typeLower = callTypeFilter.toLowerCase();
      filtered = filtered.filter(record => record.call_type?.toLowerCase() === typeLower);
    }

    if (dateFromFilter) {
      filtered = filtered.filter(record => record.call_date && record.call_date >= dateFromFilter);
    }
    if (dateToFilter) {
      filtered = filtered.filter(record => record.call_date && record.call_date <= dateToFilter);
    }

    if (durationMinFilter) {
      const minDuration = parseInt(durationMinFilter, 10);
      if (!Number.isNaN(minDuration)) {
        filtered = filtered.filter(record => (record.duration_sec ?? 0) >= minDuration);
      }
    }
    if (durationMaxFilter) {
      const maxDuration = parseInt(durationMaxFilter, 10);
      if (!Number.isNaN(maxDuration)) {
        filtered = filtered.filter(record => (record.duration_sec ?? 0) <= maxDuration);
      }
    }

    return filtered;
  }, [selectedTab, data, deferredSearchTerm, callTypeFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter]);

  useEffect(() => {
    markPerformanceEvent('tower.tab-opened', { caseId: caseId || null, tab: selectedTab });
    if (selectedTab === 'map' || selectedTab === 'graph' || selectedTab === 'party_graph' || selectedTab === 'charts') {
      markPerformanceEvent('tower.heavy-tab-rendered', { caseId: caseId || null, tab: selectedTab });
    }
  }, [caseId, selectedTab]);

  useEffect(() => {
    if (!caseId) {
      clearWorkspaceContext();
      return;
    }

    const normalizedView = selectedTab === 'graph'
      ? 'network-graph'
      : selectedTab === 'party_graph'
        ? 'party-graph'
        : selectedTab;

    setWorkspaceContext({
      caseId,
      caseTag: caseName || null,
      module: 'tower',
      view: normalizedView,
      filters: selectedTab === 'records'
        ? {
            search: searchTerm || null,
            callType: callTypeFilter || null,
            dateFrom: dateFromFilter || null,
            dateTo: dateToFilter || null,
            durationMin: durationMinFilter || null,
            durationMax: durationMaxFilter || null
          }
        : null,
      searchState: selectedTab === 'records'
        ? {
            query: searchTerm || null,
            resultCount: caseId ? recordsPagination.total : filteredData.length
          }
        : null,
      mapState: selectedTab === 'map' || selectedTab === 'graph'
        ? {
            selectedTower: selectedTower || null,
            timeFilter: {
              startDate: mapTimeFilter.startDate || null,
              endDate: mapTimeFilter.endDate || null
            }
          }
        : null,
      graphState: selectedTab === 'party_graph'
        ? {
            selectedNode: selectedParty || null,
            viewMode: partyGraphViewMode,
            timeFilter: {
              startDate: partyGraphTimeFilter.startDate || null,
              endDate: partyGraphTimeFilter.endDate || null
            }
          }
        : null,
      selectedEntities: selectedParty ? [selectedParty] : selectedTower ? [selectedTower] : [],
      selectionTimestamp: new Date().toISOString()
    });
  }, [
    caseId,
    caseName,
    selectedTab,
    searchTerm,
    callTypeFilter,
    dateFromFilter,
    dateToFilter,
    durationMinFilter,
    durationMaxFilter,
    filteredData.length,
    selectedTower,
    mapTimeFilter.startDate,
    mapTimeFilter.endDate,
    selectedParty,
    partyGraphTimeFilter.startDate,
    partyGraphTimeFilter.endDate,
    partyGraphViewMode,
    setWorkspaceContext,
    clearWorkspaceContext
  ]);

  useEffect(() => () => {
    clearWorkspaceContext();
  }, [clearWorkspaceContext]);

  useEffect(() => {
    if (selectedTab === 'records') {
      setCurrentPage(1);
    }
  }, [selectedTab, deferredSearchTerm, callTypeFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter]);

  const recordsQueryKey = useMemo(
    () => [deferredSearchTerm, callTypeFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter, itemsPerPage].join('|'),
    [deferredSearchTerm, callTypeFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter, itemsPerPage]
  );

  const {
    data: remoteRecords,
    loading: recordsLoading,
    error: recordsError,
    pagination: recordsPagination,
    totalPages: remoteTotalPages,
    showingStart: remoteShowingStart,
    showingEnd: remoteShowingEnd
  } = usePaginatedAnalysisRecords<NormalizedTowerDump>({
    enabled: Boolean(caseId && selectedTab === 'records'),
    moduleKey: 'tower',
    page: currentPage,
    pageSize: itemsPerPage,
    fetchPage: async () => {
      const response = await towerDumpAPI.getRecordsPage(caseId!, {
        page: currentPage,
        pageSize: itemsPerPage,
        search: deferredSearchTerm || undefined,
        callType: callTypeFilter || undefined,
        dateFrom: dateFromFilter || undefined,
        dateTo: dateToFilter || undefined,
        durationMin: durationMinFilter || undefined,
        durationMax: durationMaxFilter || undefined
      });
      return response as { data: NormalizedTowerDump[]; pagination: { page: number; pageSize: number; total: number } };
    },
    deps: [recordsQueryKey]
  });

  // Pagination logic
  const totalPages = Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPageData = filteredData.slice(startIndex, endIndex);
  const showingStart = filteredData.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(endIndex, filteredData.length);
  const recordsRows = caseId ? remoteRecords : currentPageData;
  const recordsTotalPages = caseId ? remoteTotalPages : totalPages;
  const recordsShowingStart = caseId ? remoteShowingStart : showingStart;
  const recordsShowingEnd = caseId ? remoteShowingEnd : showingEnd;
  const recordsResultCount = caseId ? recordsPagination.total : filteredData.length;

  useEffect(() => {
    setCurrentPage(1);
  }, [itemsPerPage]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCallTypeFilter('');
    setDateFromFilter('');
    setDateToFilter('');
    setDurationMinFilter('');
    setDurationMaxFilter('');
  };

  // Get unique call types for filter dropdown
  const uniqueCallTypes = useMemo(
    () => (filterOptions.callTypes.length > 0
      ? filterOptions.callTypes
      : Array.from(new Set(data.map(r => r.call_type).filter(Boolean))).sort()),
    [data, filterOptions.callTypes]
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (date: Date) => {
    const pad2 = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  };

  const formatLatLong = (lat?: number, long?: number) => {
    if (lat === undefined || long === undefined || lat === null || long === null) return '';
    return `${lat}, ${long}`;
  };

  const parseDate = (s?: string): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const parseDateTime = (date?: string, time?: string): Date | null => {
    if (!date) return null;
    const dt = time ? `${date} ${time}` : date;
    const d = new Date(dt);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const formatDateTime = (d: Date) => {
    const pad2 = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };

  const getHour = (t?: string): number | null => {
    if (!t) return null;
    const m = t.match(/^(\d{1,2})/);
    if (!m) return null;
    const h = Number(m[1]);
    return Number.isNaN(h) ? null : h;
  };

  const normalizeCallType = (callType?: string) => {
    const t = (callType || '').toUpperCase();
    const isSms = t.includes('SMS') || t.includes('MSG');
    const isIncoming = t.includes('IN') || t.includes('MTC') || t.includes('TERM');
    if (isSms) return isIncoming ? 'SMS_IN' : 'SMS_OUT';
    return isIncoming ? 'CALL_IN' : 'CALL_OUT';
  };

  // Helper function to display IMEI/IMSI properly (convert scientific notation to decimal)
  const displayIMEI = (imei: string | null | undefined) => {
    if (!imei) return '-';
    if (/^\d+\.?\d*e[+-]\d+$/i.test(imei)) {
      try {
        // Use BigInt to preserve exact digits
        const num = parseFloat(imei);
        return BigInt(Math.round(num)).toString();
      } catch {
        return imei;
      }
    }
    return imei;
  };

  const displayIMSI = (imsi: string | null | undefined) => {
    if (!imsi) return '-';
    if (/^\d+\.?\d*e[+-]\d+$/i.test(imsi)) {
      try {
        // Use BigInt to preserve exact digits
        const num = parseFloat(imsi);
        return BigInt(Math.round(num)).toString();
      } catch {
        return imsi;
      }
    }
    return imsi;
  };

  const stats = useMemo((): TowerDumpStats => {
    const totalRecords = data.length;
    const uniqueAParties = new Set(
      data.map(r => r.a_party)
        .filter(party => party && party.trim() !== '')
    ).size;
    const uniqueBParties = new Set(
      data.map(r => r.b_party)
        .filter(party => party && party.trim() !== '')
    ).size;
    const callTypes = data.reduce((acc, r) => {
      const type = r.call_type || 'Unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const validDurations = data
      .map(r => r.duration_sec)
      .filter((d): d is number => d !== null && d !== undefined && d > 0);
    const totalDuration = validDurations.reduce((sum: number, d: number) => sum + d, 0);
    const avgDuration = validDurations.length > 0 ? Math.round(totalDuration / validDurations.length) : 0;

    // All IMEIs with frequencies
    const imeiCounts = data.reduce((acc, r) => {
      const imei = String(r.imei || 'Unknown');
      acc[imei] = (acc[imei] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const allIMEIsWithCounts = Object.entries(imeiCounts)
      .filter(([imei]) => imei !== 'Unknown')
      .sort((a, b) => b[1] - a[1]);

    // All IMSIs with frequencies
    const imsiCounts = data.reduce((acc, r) => {
      const imsi = String(r.imsi || 'Unknown');
      acc[imsi] = (acc[imsi] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const allIMSIsWithCounts = Object.entries(imsiCounts)
      .filter(([imsi]) => imsi !== 'Unknown')
      .sort((a, b) => b[1] - a[1]);

    // Common Callers (A-Party)
    const callerCounts = data.reduce((acc, r) => {
      const caller = String(r.a_party || 'Unknown');
      acc[caller] = (acc[caller] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const commonCallers = Object.entries(callerCounts)
      .filter(([caller]) => caller !== 'Unknown')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Other State Calls
    const otherStateCalls = data.filter(r => r.roaming_circle && r.roaming_circle.trim() !== '');
    const otherStateSummary = {
      count: otherStateCalls.length,
      uniqueCallers: new Set(otherStateCalls.map(r => r.a_party).filter(p => p && p.trim() !== '')).size,
      avgDuration: otherStateCalls.length > 0 ? Math.round(
        otherStateCalls
          .map(r => r.duration_sec)
          .filter((d): d is number => d !== null && d !== undefined && d > 0)
          .reduce((sum, d) => sum + d, 0) / otherStateCalls.length
      ) : 0
    };

    // Roaming Circle Summary for Other State Calls
    const otherStateRoamingCircleCounts = otherStateCalls.reduce((acc, r) => {
      const circle = r.roaming_circle || 'Unknown';
      acc[circle] = (acc[circle] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const roamingCircleSummary = Object.entries(otherStateRoamingCircleCounts)
      .map(([circle, count]) => ({ name: circle, value: count }))
      .sort((a, b) => b.value - a.value);

    // Roaming Circle Counts for Bar Chart
    const roamingCircleCounts = data.reduce((acc, r) => {
      const circle = r.roaming_circle || 'Local';
      acc[circle] = (acc[circle] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const roamingCircleData = Object.entries(roamingCircleCounts)
      .map(([circle, count]) => ({ name: circle, value: count }))
      .sort((a, b) => b.value - a.value);

    return {
      totalRecords,
      uniqueAParties,
      uniqueBParties,
      callTypes,
      avgDuration,
      allIMEIsWithCounts,
      allIMSIsWithCounts,
      commonCallers,
      otherStateSummary,
      roamingCircleSummary,
      roamingCircleData
    };
  }, [data]);

  const overviewStats = useMemo((): TowerDumpStats => {
    if (data.length > 0 || !summary) return stats;

    return {
      ...stats,
      totalRecords: Number(summary.totalRecords || 0),
      uniqueAParties: Number(summary.uniqueAParties || 0),
      uniqueBParties: Number(summary.uniqueBParties || 0),
      avgDuration: Math.round(Number(summary.avgDurationSec || 0)),
      callTypes: Object.fromEntries(
        Array.isArray(summary.callTypes)
          ? summary.callTypes.map((entry) => [String(entry.label || 'UNKNOWN'), Number(entry.value || 0)])
          : []
      ),
      commonCallers: Array.isArray(summary.topParties)
        ? summary.topParties.map((entry) => [String(entry.label || 'UNKNOWN'), Number(entry.value || 0)] as [string, number])
        : [],
    };
  }, [data.length, stats, summary]);

  const buildTowerDumpSheets = (rows: NormalizedTowerDump[]) => {
    const sheet1Headers = [
      "CDR Party No", "Opposite Party No", "Opp Party-Name", "Opp Party-Full Address", "Opp Party-SP State",
      "CALL_DATE", "CALL_TIME", "Call_Type_Std", "CALL_DURATION", "FIRST_CELL_ID_A", "First_Cell_Site_Address",
      "First_Cell_Site_Name-City", "First_Lat_Long", "LAST_CELL_ID_A", "Last_Cell_Site_Address",
      "Last_Cell_Site_Name-City", "Last_Lat_Long", "ESN_IMEI_A", "IMSI_A", "CUST_TYPE", "SMSC_CENTER",
      "Home Circle", "ROAM_CIRCLE", "Opp Party-Activation Date", "Opp Party-Service Provider", "ID"
    ];

    const sheet1Rows: SheetRow[] = rows.map((r, i) => ({
      "CDR Party No": r.a_party || '',
      "Opposite Party No": r.b_party || '',
      "Opp Party-Name": r.lrn_description || '',
      "Opp Party-Full Address": '',
      "Opp Party-SP State": r.roaming_circle || '',
      "CALL_DATE": r.call_date || '',
      "CALL_TIME": r.call_start_time || '',
      "Call_Type_Std": normalizeCallType(r.call_type),
      "CALL_DURATION": r.duration_sec || 0,
      "FIRST_CELL_ID_A": r.first_cell_id || '',
      "First_Cell_Site_Address": r.first_cell_desc || '',
      "First_Cell_Site_Name-City": r.first_cell_desc || '',
      "First_Lat_Long": formatLatLong(r.first_cell_lat, r.first_cell_long),
      "LAST_CELL_ID_A": r.last_cell_id || '',
      "Last_Cell_Site_Address": r.last_cell_desc || '',
      "Last_Cell_Site_Name-City": r.last_cell_desc || '',
      "Last_Lat_Long": formatLatLong(r.last_cell_lat, r.last_cell_long),
      "ESN_IMEI_A": r.imei || '',
      "IMSI_A": r.imsi || '',
      "CUST_TYPE": r.toc || '',
      "SMSC_CENTER": r.smsc_number || '',
      "Home Circle": '',
      "ROAM_CIRCLE": r.roaming_circle || '',
      "Opp Party-Activation Date": '',
      "Opp Party-Service Provider": r.operator || '',
      "ID": r.record_id || i + 1
    }));

    const relationHeaders = [
      "ID", "CDR Party No", "Opposite Party No", "Opp Party-SP State",
      "Opp Party-Name", "Opp Party-Full Address", "Start_Date", "End_Date",
      "Date_Diff", "Total Event", "Call In", "Call Out", "SMS In", "SMS Out",
      "Call In_Duration", "Call Out_Duration", "Total_Duration"
    ];

    const relationMap = new Map<string, {
      id: number;
      aParty: string;
      bParty: string;
      roam: string;
      start: Date | null;
      end: Date | null;
      total: number;
      callIn: number;
      callOut: number;
      smsIn: number;
      smsOut: number;
      callInDur: number;
      callOutDur: number;
      totalDur: number;
    }>();
    let relationId = 1;
    rows.forEach(r => {
      const a = r.a_party || '';
      const b = r.b_party || '';
      if (!b) return;
      const key = `${a}||${b}`;
      if (!relationMap.has(key)) {
        relationMap.set(key, {
          id: relationId++,
          aParty: a,
          bParty: b,
          roam: r.roaming_circle || '',
          start: null,
          end: null,
          total: 0,
          callIn: 0,
          callOut: 0,
          smsIn: 0,
          smsOut: 0,
          callInDur: 0,
          callOutDur: 0,
          totalDur: 0
        });
      }
      const entry = relationMap.get(key);
      if (!entry) return;
      const date = parseDate(r.call_date);
      if (date) {
        if (!entry.start || date < entry.start) entry.start = date;
        if (!entry.end || date > entry.end) entry.end = date;
      }
      const type = normalizeCallType(r.call_type);
      entry.total += 1;
      if (type === 'CALL_IN') {
        entry.callIn += 1;
        entry.callInDur += r.duration_sec || 0;
      } else if (type === 'CALL_OUT') {
        entry.callOut += 1;
        entry.callOutDur += r.duration_sec || 0;
      } else if (type === 'SMS_IN') {
        entry.smsIn += 1;
      } else {
        entry.smsOut += 1;
      }
      entry.totalDur += r.duration_sec || 0;
    });
    const relationRows: SheetRow[] = Array.from(relationMap.values()).map(r => {
      const dateDiff = r.start && r.end ? Math.max(0, Math.round((r.end.getTime() - r.start.getTime()) / (1000 * 60 * 60 * 24))) : 0;
      return {
        "ID": r.id,
        "CDR Party No": r.aParty,
        "Opposite Party No": r.bParty,
        "Opp Party-SP State": r.roam,
        "Opp Party-Name": r.bParty,
        "Opp Party-Full Address": '',
        "Start_Date": r.start ? formatDate(r.start) : '',
        "End_Date": r.end ? formatDate(r.end) : '',
        "Date_Diff": dateDiff,
        "Total Event": r.total,
        "Call In": r.callIn,
        "Call Out": r.callOut,
        "SMS In": r.smsIn,
        "SMS Out": r.smsOut,
        "Call In_Duration": r.callInDur,
        "Call Out_Duration": r.callOutDur,
        "Total_Duration": r.totalDur
      };
    });

    const cellHeaders = [
      "Id", "CDR Party No", "FIRST_CELL_ID_A", "First_Cell_Site_Address",
      "First_Lat_Long", "Total Event", "Call In", "Call Out", "SMS In", "SMS Out",
      "Call In_Duration", "Call Out_Duration", "Total_Duration", "ROAM_CIRCLE",
      "First_Cell_Site_Name-City"
    ];
    const cellMap = new Map<string, {
      id: number;
      aParty: string;
      cell: string;
      addr: string;
      latLong: string;
      roam: string;
      total: number;
      callIn: number;
      callOut: number;
      smsIn: number;
      smsOut: number;
      callInDur: number;
      callOutDur: number;
      totalDur: number;
    }>();
    let cellId = 1;
    rows.forEach(r => {
      const a = r.a_party || '';
      const cell = r.first_cell_id || '';
      if (!cell) return;
      const key = `${a}||${cell}`;
      if (!cellMap.has(key)) {
        cellMap.set(key, {
          id: cellId++,
          aParty: a,
          cell,
          addr: r.first_cell_desc || '',
          latLong: formatLatLong(r.first_cell_lat, r.first_cell_long),
          roam: r.roaming_circle || '',
          total: 0,
          callIn: 0,
          callOut: 0,
          smsIn: 0,
          smsOut: 0,
          callInDur: 0,
          callOutDur: 0,
          totalDur: 0
        });
      }
      const entry = cellMap.get(key);
      if (!entry) return;
      const type = normalizeCallType(r.call_type);
      entry.total += 1;
      if (type === 'CALL_IN') {
        entry.callIn += 1;
        entry.callInDur += r.duration_sec || 0;
      } else if (type === 'CALL_OUT') {
        entry.callOut += 1;
        entry.callOutDur += r.duration_sec || 0;
      } else if (type === 'SMS_IN') {
        entry.smsIn += 1;
      } else {
        entry.smsOut += 1;
      }
      entry.totalDur += r.duration_sec || 0;
    });
    const cellRows: SheetRow[] = Array.from(cellMap.values()).map(r => ({
      "Id": r.id,
      "CDR Party No": r.aParty,
      "FIRST_CELL_ID_A": r.cell,
      "First_Cell_Site_Address": r.addr,
      "First_Lat_Long": r.latLong,
      "Total Event": r.total,
      "Call In": r.callIn,
      "Call Out": r.callOut,
      "SMS In": r.smsIn,
      "SMS Out": r.smsOut,
      "Call In_Duration": r.callInDur,
      "Call Out_Duration": r.callOutDur,
      "Total_Duration": r.totalDur,
      "ROAM_CIRCLE": r.roam,
      "First_Cell_Site_Name-City": r.addr
    }));

    const movementHeaders = [
      "ID", "CDR Party No", "Opposite Party No", "CALL_DATE", "CALL_TIME",
      "FIRST_CELL_ID_A", "First_Cell_Site_Name-City", "First_Cell_Site_Address", "First_Lat_Long"
    ];
    const movementRows: SheetRow[] = rows.map((r, i) => ({
      "ID": i + 1,
      "CDR Party No": r.a_party || '',
      "Opposite Party No": r.b_party || '',
      "CALL_DATE": r.call_date || '',
      "CALL_TIME": r.call_start_time || '',
      "FIRST_CELL_ID_A": r.first_cell_id || '',
      "First_Cell_Site_Name-City": r.first_cell_desc || '',
      "First_Cell_Site_Address": r.first_cell_desc || '',
      "First_Lat_Long": formatLatLong(r.first_cell_lat, r.first_cell_long)
    }));

    const imeiHeaders = [
      "ID", "CDR Party No", "CDR Party-Name", "CDR Party-Full Address",
      "CDR Party-Service Provider", "IMEI", "First_Call", "Last_call",
      "Total Event", "Call In", "Call Out", "SMS In", "SMS Out",
      "Call In_Duration", "Call Out_Duration", "Total_Duration"
    ];
    const imeiMap = new Map<string, {
      id: number;
      aParty: string;
      imei: string;
      first: Date | null;
      last: Date | null;
      total: number;
      callIn: number;
      callOut: number;
      smsIn: number;
      smsOut: number;
      callInDur: number;
      callOutDur: number;
      totalDur: number;
    }>();
    let imeiId = 1;
    rows.forEach(r => {
      const a = r.a_party || '';
      const imei = r.imei || '';
      if (!imei) return;
      const key = `${a}||${imei}`;
      if (!imeiMap.has(key)) {
        imeiMap.set(key, {
          id: imeiId++,
          aParty: a,
          imei,
          first: null,
          last: null,
          total: 0,
          callIn: 0,
          callOut: 0,
          smsIn: 0,
          smsOut: 0,
          callInDur: 0,
          callOutDur: 0,
          totalDur: 0
        });
      }
      const entry = imeiMap.get(key);
      if (!entry) return;
      const dt = parseDateTime(r.call_date, r.call_start_time);
      if (dt) {
        if (!entry.first || dt < entry.first) entry.first = dt;
        if (!entry.last || dt > entry.last) entry.last = dt;
      }
      const type = normalizeCallType(r.call_type);
      entry.total += 1;
      if (type === 'CALL_IN') {
        entry.callIn += 1;
        entry.callInDur += r.duration_sec || 0;
      } else if (type === 'CALL_OUT') {
        entry.callOut += 1;
        entry.callOutDur += r.duration_sec || 0;
      } else if (type === 'SMS_IN') {
        entry.smsIn += 1;
      } else {
        entry.smsOut += 1;
      }
      entry.totalDur += r.duration_sec || 0;
    });
    const imeiRows: SheetRow[] = Array.from(imeiMap.values()).map(r => ({
      "ID": r.id,
      "CDR Party No": r.aParty,
      "CDR Party-Name": '',
      "CDR Party-Full Address": '',
      "CDR Party-Service Provider": operator || '',
      "IMEI": r.imei,
      "First_Call": r.first ? formatDateTime(r.first) : '',
      "Last_call": r.last ? formatDateTime(r.last) : '',
      "Total Event": r.total,
      "Call In": r.callIn,
      "Call Out": r.callOut,
      "SMS In": r.smsIn,
      "SMS Out": r.smsOut,
      "Call In_Duration": r.callInDur,
      "Call Out_Duration": r.callOutDur,
      "Total_Duration": r.totalDur
    }));

    const stateHeaders = [
      "Id", "CDR Party No", "Connection of State", "Total Event",
      "Call In", "Call Out", "SMS In", "SMS Out",
      "Call In_Duration", "Call Out_Duration", "Total_Duration"
    ];
    const stateMap = new Map<string, {
      id: number;
      aParty: string;
      state: string;
      total: number;
      callIn: number;
      callOut: number;
      smsIn: number;
      smsOut: number;
      callInDur: number;
      callOutDur: number;
      totalDur: number;
    }>();
    let stateId = 1;
    rows.forEach(r => {
      const a = r.a_party || '';
      const state = r.roaming_circle || '';
      if (!state) return;
      const key = `${a}||${state}`;
      if (!stateMap.has(key)) {
        stateMap.set(key, {
          id: stateId++,
          aParty: a,
          state,
          total: 0,
          callIn: 0,
          callOut: 0,
          smsIn: 0,
          smsOut: 0,
          callInDur: 0,
          callOutDur: 0,
          totalDur: 0
        });
      }
      const entry = stateMap.get(key);
      if (!entry) return;
      const type = normalizeCallType(r.call_type);
      entry.total += 1;
      if (type === 'CALL_IN') {
        entry.callIn += 1;
        entry.callInDur += r.duration_sec || 0;
      } else if (type === 'CALL_OUT') {
        entry.callOut += 1;
        entry.callOutDur += r.duration_sec || 0;
      } else if (type === 'SMS_IN') {
        entry.smsIn += 1;
      } else {
        entry.smsOut += 1;
      }
      entry.totalDur += r.duration_sec || 0;
    });
    const stateRows: SheetRow[] = Array.from(stateMap.values()).map(r => ({
      "Id": r.id,
      "CDR Party No": r.aParty,
      "Connection of State": r.state,
      "Total Event": r.total,
      "Call In": r.callIn,
      "Call Out": r.callOut,
      "SMS In": r.smsIn,
      "SMS Out": r.smsOut,
      "Call In_Duration": r.callInDur,
      "Call Out_Duration": r.callOutDur,
      "Total_Duration": r.totalDur
    }));

    const isdHeaders = [
      "CdrNo", "B Party", "Date", "Time", "Duration", "Call Type",
      "First Cell ID", "First Cell ID Address", "Last Cell ID",
      "Last Cell ID Address", "IMEI", "IMSI", "Roaming", "Operator"
    ];
    const isInternational = (num?: string) => {
      if (!num) return false;
      const s = num.trim();
      if (!s) return false;
      const numClean = s.replace(/\D/g, '');
      return s.startsWith('+') || s.startsWith('00') || numClean.length > 12;
    };
    const isdRows: SheetRow[] = rows
      .filter(r => ['CALL_IN', 'CALL_OUT'].includes(normalizeCallType(r.call_type)) && isInternational(r.b_party))
      .map(r => ({
        "CdrNo": r.a_party || '',
        "B Party": r.b_party || '',
        "Date": r.call_date || '',
        "Time": r.call_start_time || '',
        "Duration": r.duration_sec || 0,
        "Call Type": normalizeCallType(r.call_type),
        "First Cell ID": r.first_cell_id || '',
        "First Cell ID Address": r.first_cell_desc || '',
        "Last Cell ID": r.last_cell_id || '',
        "Last Cell ID Address": r.last_cell_desc || '',
        "IMEI": r.imei || '',
        "IMSI": r.imsi || '',
        "Roaming": r.roaming_circle || '',
        "Operator": r.operator || ''
      }));

    const nightHeaders = [
      "Id", "CDR Party No", "Opposite Party No", "Opp Party-Name",
      "Opp Party-Full Address", "Opp Party-SP State", "Total Event",
      "Call In", "Call Out", "SMS In", "SMS Out",
      "Call In_Duration", "Call Out_Duration", "Total_Duration"
    ];
    const nightMap = new Map<string, {
      id: number;
      aParty: string;
      bParty: string;
      roam: string;
      total: number;
      callIn: number;
      callOut: number;
      smsIn: number;
      smsOut: number;
      callInDur: number;
      callOutDur: number;
      totalDur: number;
    }>();
    let nightId = 1;
    rows.forEach(r => {
      const hour = getHour(r.call_start_time);
      if (hour === null) return;
      if (!(hour >= 20 || hour < 7)) return;
      const a = r.a_party || '';
      const b = r.b_party || '';
      if (!b) return;
      const key = `${a}||${b}`;
      if (!nightMap.has(key)) {
        nightMap.set(key, {
          id: nightId++,
          aParty: a,
          bParty: b,
          roam: r.roaming_circle || '',
          total: 0,
          callIn: 0,
          callOut: 0,
          smsIn: 0,
          smsOut: 0,
          callInDur: 0,
          callOutDur: 0,
          totalDur: 0
        });
      }
      const entry = nightMap.get(key);
      if (!entry) return;
      const type = normalizeCallType(r.call_type);
      entry.total += 1;
      if (type === 'CALL_IN') {
        entry.callIn += 1;
        entry.callInDur += r.duration_sec || 0;
      } else if (type === 'CALL_OUT') {
        entry.callOut += 1;
        entry.callOutDur += r.duration_sec || 0;
      } else if (type === 'SMS_IN') {
        entry.smsIn += 1;
      } else {
        entry.smsOut += 1;
      }
      entry.totalDur += r.duration_sec || 0;
    });
    const nightRows: SheetRow[] = Array.from(nightMap.values()).map(r => ({
      "Id": r.id,
      "CDR Party No": r.aParty,
      "Opposite Party No": r.bParty,
      "Opp Party-Name": r.bParty,
      "Opp Party-Full Address": '',
      "Opp Party-SP State": r.roam,
      "Total Event": r.total,
      "Call In": r.callIn,
      "Call Out": r.callOut,
      "SMS In": r.smsIn,
      "SMS Out": r.smsOut,
      "Call In_Duration": r.callInDur,
      "Call Out_Duration": r.callOutDur,
      "Total_Duration": r.totalDur
    }));

    const switchHeaders = ["ID", "Start_Date", "End_Date", "Total_Day"];
    const switchRows: SheetRow[] = [];
    let switchId = 1;
    const dateMap = new Map<string, Date[]>();
    rows.forEach(r => {
      const a = r.a_party || '';
      if (!a) return;
      const d = parseDate(r.call_date);
      if (!d) return;
      if (!dateMap.has(a)) dateMap.set(a, []);
      dateMap.get(a)?.push(d);
    });
    dateMap.forEach(dates => {
      const uniqueDates = Array.from(new Set(dates.map(d => formatDate(d))))
        .map(ds => parseDate(ds))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      for (let i = 0; i < uniqueDates.length - 1; i++) {
        const diff = Math.round((uniqueDates[i + 1].getTime() - uniqueDates[i].getTime()) / (1000 * 60 * 60 * 24));
        if (diff > 1) {
          switchRows.push({
            "ID": switchId++,
            "Start_Date": formatDate(uniqueDates[i]),
            "End_Date": formatDate(uniqueDates[i + 1]),
            "Total_Day": diff
          });
        }
      }
    });

    return [
      { name: "_01_CDR_Format", headers: sheet1Headers, rows: sheet1Rows },
      { name: "_02_Relationship_Call_Frequ", headers: relationHeaders, rows: relationRows },
      { name: "_03_Cell_ID_Frequency", headers: cellHeaders, rows: cellRows },
      { name: "_04_Movement_Analysis", headers: movementHeaders, rows: movementRows },
      { name: "_05_Imei_Used", headers: imeiHeaders, rows: imeiRows },
      { name: "_06_State_Connection", headers: stateHeaders, rows: stateRows },
      { name: "_07_ISD_Call", headers: isdHeaders, rows: isdRows },
      { name: "_08_Night_Call", headers: nightHeaders, rows: nightRows },
      { name: "_09_Mobile_SwitchOFF", headers: switchHeaders, rows: switchRows }
    ];
  };

  const handleExportExcel = async () => {
    if (isExporting) return;
    try {
      setIsExporting(true);
      await yieldToUI();
      const sheets = buildTowerDumpSheets(data);
      const workbook = XLSX.utils.book_new();
      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet([sheet.headers]);
        XLSX.utils.sheet_add_json(ws, encodeSpreadsheetRows(sheet.rows), { header: sheet.headers, skipHeader: true, origin: 'A2' });
        applyHeaderStylesAndFilter(ws, sheet.headers, 'FF2563EB');
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
        applySheetTabColor(workbook, sheet.name, 'FF2563EB');
        await yieldToUI();
      }
      const safeCase = (caseName || 'Case').replace(/\s+/g, '_');
      const fileName = `Tower_Dump_Analysis_${safeCase}_${formatDate(new Date())}.xlsx`;
      await yieldToUI();
      XLSX.writeFile(workbook, fileName);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="analysis-shell relative z-0 flex h-full flex-col overflow-hidden font-display">
      {/* Header */}
      <header className="analysis-topbar flex min-h-20 shrink-0 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="material-symbols-outlined text-slate-700 dark:text-white text-2xl hover:text-blue-500 transition-colors"
          >
            arrow_back
          </button>
          <span className="material-symbols-outlined text-slate-700 dark:text-white text-2xl">analytics</span>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Tower Dump Analysis</h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Case: {caseName} • {operator}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={handleExportExcel} disabled={isExporting} className="flex items-center gap-2 px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            <span className={`material-symbols-outlined text-sm ${isExporting ? 'animate-spin' : ''}`}>{isExporting ? 'progress_activity' : 'file_download'}</span>
            {isExporting ? 'Exporting...' : 'Export Excel'}
          </button>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs font-mono">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {formatTime(currentTime)}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Analysis Active</span>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <AnalysisTabBar
        value={selectedTab}
        onChange={setSelectedTab}
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'overview' },
          { id: 'records', label: 'Records', icon: 'records' },
          { id: 'map', label: 'Map View', icon: 'map' },
          { id: 'graph', label: 'Network Graph', icon: 'graph' },
          { id: 'party_graph', label: 'Party Graph', icon: 'party_graph' },
          { id: 'charts', label: 'Charts', icon: 'charts' }
        ]}
      />

      {isExporting && (
        <div className="absolute inset-0 z-50 bg-slate-900/30 backdrop-blur-[1px] flex items-center justify-center pointer-events-auto">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center gap-3">
            <span className="material-symbols-outlined animate-spin text-blue-600 dark:text-blue-400">progress_activity</span>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Preparing Excel export</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Please wait, large analysis can take time.</div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="analysis-content custom-scrollbar flex-1 overflow-y-auto p-6">
        {loading && data.length === 0 ? (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
            Loading tower dump records in the background. The workspace stays interactive while detailed analytics hydrate.
          </div>
        ) : null}

        {selectedTab === 'overview' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {!loading && data.length === 0 && !summary ? (
              // Empty state
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="material-symbols-outlined text-6xl text-slate-400 mb-4">analytics_off</span>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">No Tower Dump Records Found</h3>
                <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md">
                  This case doesn't have any tower dump records in the database. 
                  You may need to re-upload the tower dump files or check the database.
                </p>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-mono bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded">
                  Case ID: {caseName}
                </div>
              </div>
            ) : (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-2xl text-blue-500">description</span>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{getMetricUiLabel('total_records', 'Total Records')}</h3>
                </div>
                <p className="text-3xl font-black text-blue-600 dark:text-blue-400">{overviewStats.totalRecords.toLocaleString()}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">From {fileCountState} file(s)</p>
              </div>

              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-2xl text-green-500">person</span>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Unique A-Parties</h3>
                </div>
                <p className="text-3xl font-black text-green-600 dark:text-green-400">{overviewStats.uniqueAParties.toLocaleString()}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Target numbers</p>
              </div>

              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-2xl text-purple-500">call</span>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Unique B-Parties</h3>
                </div>
                <p className="text-3xl font-black text-purple-600 dark:text-purple-400">{overviewStats.uniqueBParties.toLocaleString()}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Called numbers</p>
              </div>

              <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-2xl text-orange-500">schedule</span>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Avg Duration</h3>
                </div>
                <p className="text-3xl font-black text-orange-600 dark:text-orange-400">{overviewStats.avgDuration}s</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Per call</p>
              </div>
            </div>

            {/* All IMEIs with Frequencies */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">All IMEIs with Frequencies ({stats.allIMEIsWithCounts.length})</h3>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {stats.allIMEIsWithCounts.length > 0 ? stats.allIMEIsWithCounts.map(([imei, count]) => (
                  <div key={imei} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded">
                    <span className="font-mono text-sm text-slate-900 dark:text-white">{displayIMEI(imei)}</span>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded">
                      {count} calls
                    </span>
                  </div>
                )) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">No IMEI data available</p>
                )}
              </div>
            </div>

            {/* All IMSIs with Frequencies */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">All IMSIs with Frequencies ({stats.allIMSIsWithCounts.length})</h3>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {stats.allIMSIsWithCounts.length > 0 ? stats.allIMSIsWithCounts.map(([imsi, count]) => (
                  <div key={imsi} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded">
                    <span className="font-mono text-sm text-slate-900 dark:text-white">{displayIMSI(imsi)}</span>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded">
                      {count} calls
                    </span>
                  </div>
                )) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">No IMSI data available</p>
                )}
              </div>
            </div>

            {/* Common Callers */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Common Callers (A-Party)</h3>
              <div className="space-y-2">
                {overviewStats.commonCallers.length > 0 ? overviewStats.commonCallers.map(([caller, count]) => (
                  <div key={caller} className="flex justify-between items-center">
                    <span className="font-mono text-sm text-slate-900 dark:text-white">{caller}</span>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{count} calls</span>
                  </div>
                )) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">No caller data available</p>
                )}
              </div>
            </div>

            {/* Other State Summary */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Other State Calls Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">{overviewStats.otherStateSummary.count}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">Total Calls</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">{overviewStats.otherStateSummary.uniqueCallers}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">Unique Callers</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">{overviewStats.otherStateSummary.avgDuration}s</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">Avg Duration</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">{overviewStats.roamingCircleSummary[0]?.name || 'N/A'}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">Top Roaming Circle ({overviewStats.roamingCircleSummary[0]?.value || 0} calls)</div>
                </div>
              </div>

              {/* Roaming Circle Summary Table */}
              <div className="mt-6">
                <h4 className="text-md font-bold text-slate-900 dark:text-white mb-4">Roaming Circle Breakdown</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-slate-300 dark:border-slate-600">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-700">
                        <th className="py-2 px-3 text-left text-slate-900 dark:text-white font-medium">Roaming Circle</th>
                        <th className="py-2 px-3 text-left text-slate-900 dark:text-white font-medium">Call Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewStats.roamingCircleSummary.length > 0 ? overviewStats.roamingCircleSummary.map((item, index) => (
                        <tr key={index} className="border-b border-slate-200 dark:border-slate-600">
                          <td className="py-2 px-3 text-slate-900 dark:text-white">{item.name}</td>
                          <td className="py-2 px-3 text-slate-900 dark:text-white">{item.value}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={2} className="py-2 px-3 text-center text-slate-600 dark:text-slate-400">No roaming circle data available</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Call Types Distribution */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Call Types Distribution</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(overviewStats.callTypes).map(([type, count]) => (
                  <div key={type} className="text-center">
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">{count}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">{type}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Records Preview */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Recent Records</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">A-Party</th>
                      <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">B-Party</th>
                      <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Call Type</th>
                      <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Duration</th>
                      <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400">Date/Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slice(0, 10).map((record, index) => (
                      <tr key={index} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 px-3 font-mono text-slate-900 dark:text-white">{record.a_party || '-'}</td>
                        <td className="py-2 px-3 font-mono text-slate-900 dark:text-white">{record.b_party || '-'}</td>
                        <td className="py-2 px-3 text-slate-900 dark:text-white">{record.call_type || '-'}</td>
                        <td className="py-2 px-3 text-slate-900 dark:text-white">{record.duration_sec || 0}s</td>
                        <td className="py-2 px-3 text-slate-900 dark:text-white">
                          {record.call_date && record.call_start_time ? `${record.call_date} ${record.call_start_time}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
        </>

        )}

          </div>
        )}
        {selectedTab === 'records' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Filters */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Filters</h3>
                <button
                  onClick={clearFilters}
                  className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Clear All
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {/* Search */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="material-symbols-outlined text-slate-500 text-sm">search</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block w-full pl-8 pr-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* Call Type Filter */}
                <select
                  value={callTypeFilter}
                  onChange={(e) => setCallTypeFilter(e.target.value)}
                  className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="">All Call Types</option>
                  {uniqueCallTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>

                {/* Date From */}
                <input
                  type="date"
                  value={dateFromFilter}
                  onChange={(e) => setDateFromFilter(e.target.value)}
                  className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="From Date"
                />

                {/* Date To */}
                <input
                  type="date"
                  value={dateToFilter}
                  onChange={(e) => setDateToFilter(e.target.value)}
                  className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="To Date"
                />

                {/* Duration Min */}
                <input
                  type="number"
                  placeholder="Min Duration (s)"
                  value={durationMinFilter}
                  onChange={(e) => setDurationMinFilter(e.target.value)}
                  className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  min="0"
                />

                {/* Duration Max */}
                <input
                  type="number"
                  placeholder="Max Duration (s)"
                  value={durationMaxFilter}
                  onChange={(e) => setDurationMaxFilter(e.target.value)}
                  className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  min="0"
                />
              </div>
            </div>

            {/* Records Table */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 overflow-hidden">
              {recordsError ? (
                <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {recordsError}
                </div>
              ) : null}
              {recordsLoading ? (
                <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                  Loading tower dump records...
                </div>
              ) : null}
              <div className="max-h-[600px] overflow-y-auto">
                <RecordTable rows={recordsRows as unknown as Record<string, unknown>[]} maxRows={50} />
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                    <div>
                      Showing {recordsShowingStart}-{recordsShowingEnd} of {recordsResultCount} records
                      {!caseId && filteredData.length !== data.length && ` (filtered from ${data.length} total)`}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-500">Rows</span>
                      <select
                        value={itemsPerPage}
                        onChange={(e) => setItemsPerPage(Number(e.target.value))}
                        className="px-2 py-1 text-xs bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded text-slate-700 dark:text-slate-300"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">chevron_left</span>
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, recordsTotalPages) }, (_, i) => {
                        const pageNum = Math.max(1, Math.min(recordsTotalPages - 4, currentPage - 2)) + i;
                        if (pageNum > recordsTotalPages) return null;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => goToPage(pageNum)}
                            className={`px-3 py-1 text-sm rounded transition-colors ${
                              pageNum === currentPage
                                ? 'bg-blue-500 text-white'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={recordsTotalPages}
                        value={currentPage}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          if (!Number.isNaN(next)) goToPage(next);
                        }}
                        className="w-16 px-2 py-1 text-sm bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded text-slate-700 dark:text-slate-300"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-500">of {recordsTotalPages}</span>
                    </div>

                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === recordsTotalPages}
                      className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">chevron_right</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedTab === 'map' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Map Time Filters */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Map Filters</h3>
                <button
                  onClick={() => setMapTimeFilter({})}
                  className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Clear Filters
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Map Date From */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={mapTimeFilter.startDate || ''}
                    onChange={(e) => setMapTimeFilter(prev => ({ ...prev, startDate: e.target.value || undefined }))}
                    className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* Map Date To */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={mapTimeFilter.endDate || ''}
                    onChange={(e) => setMapTimeFilter(prev => ({ ...prev, endDate: e.target.value || undefined }))}
                    className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* Selected Tower Info */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Selected Tower
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={selectedTower || ''}
                      readOnly
                      placeholder="Click on a tower to select"
                      className="block w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600"
                    />
                    {selectedTower && (
                      <button
                        onClick={() => setSelectedTower(null)}
                        className="px-2 py-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        <span className="material-symbols-outlined text-lg">clear</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Map Component */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 overflow-hidden">
              <div className="h-[600px]">
                <TowerMap
                  data={data}
                  selectedTower={selectedTower}
                  onTowerSelect={setSelectedTower}
                  timeFilter={mapTimeFilter}
                />
              </div>
            </div>
          </div>
        )}

        {selectedTab === 'graph' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Graph Time Filters */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Graph Filters</h3>
                <button
                  onClick={() => setMapTimeFilter({})}
                  className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Clear Filters
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Graph Date From */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={mapTimeFilter.startDate || ''}
                    onChange={(e) => setMapTimeFilter(prev => ({ ...prev, startDate: e.target.value || undefined }))}
                    className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* Graph Date To */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={mapTimeFilter.endDate || ''}
                    onChange={(e) => setMapTimeFilter(prev => ({ ...prev, endDate: e.target.value || undefined }))}
                    className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* Selected Tower Info */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Selected Tower
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={selectedTower || ''}
                      readOnly
                      placeholder="Click on a node to select"
                      className="block w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600"
                    />
                    {selectedTower && (
                      <button
                        onClick={() => setSelectedTower(null)}
                        className="px-2 py-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        <span className="material-symbols-outlined text-lg">clear</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Graph Component */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 overflow-hidden">
              <div className="h-[600px]">
                <TowerGraph
                  data={data}
                  selectedTower={selectedTower}
                  onTowerSelect={setSelectedTower}
                  timeFilter={mapTimeFilter}
                />
              </div>
            </div>
          </div>
        )}

        {selectedTab === 'party_graph' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Party Graph Filters</h3>
                <button
                  onClick={() => {
                    setPartyGraphTimeFilter({});
                    setSelectedParty(null);
                  }}
                  className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Clear Filters
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={partyGraphTimeFilter.startDate || ''}
                    onChange={(e) => setPartyGraphTimeFilter(prev => ({ ...prev, startDate: e.target.value || undefined }))}
                    className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={partyGraphTimeFilter.endDate || ''}
                    onChange={(e) => setPartyGraphTimeFilter(prev => ({ ...prev, endDate: e.target.value || undefined }))}
                    className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Graph Mode
                  </label>
                  <select
                    value={partyGraphViewMode}
                    onChange={(e) => setPartyGraphViewMode(e.target.value as 'cluster' | 'binary')}
                    className="block w-full px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    <option value="cluster">Cluster Web</option>
                    <option value="binary">Binary Tree</option>
                  </select>
                </div>

                <div className="md:col-span-2 lg:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Selected Number
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={selectedParty || ''}
                      readOnly
                      placeholder="Click on a node to select"
                      className="block w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600"
                    />
                    {selectedParty && (
                      <button
                        onClick={() => setSelectedParty(null)}
                        className="px-2 py-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        <span className="material-symbols-outlined text-lg">clear</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={
                isPartyGraphFullscreen
                  ? 'fixed inset-2 md:inset-6 z-[1200] bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-700 shadow-2xl overflow-hidden'
                  : 'bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 overflow-hidden'
              }
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-border-light dark:border-slate-700">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Party Graph</div>
                <button
                  type="button"
                  onClick={() => setIsPartyGraphFullscreen(prev => !prev)}
                  className="px-3 py-1.5 text-xs rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  {isPartyGraphFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen'}
                </button>
              </div>
              <div className={isPartyGraphFullscreen ? 'h-[calc(100vh-6rem)]' : 'h-[600px]'}>
                <PartyNetworkGraph
                  caseId={caseId}
                  data={data}
                  selectedNode={selectedParty}
                  onNodeSelect={setSelectedParty}
                  viewMode={partyGraphViewMode}
                  timeFilter={partyGraphTimeFilter}
                />
              </div>
            </div>
          </div>
        )}

        {selectedTab === 'charts' && (
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* IMEI Pie Chart */}
              <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-slate-800 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-blue-500">phone_android</span>
                  IMEI Distribution
                </h3>
                <ResponsiveContainer width="100%" height={350}>
                  <PieChart>
                    <Pie
                      data={stats.allIMEIsWithCounts.slice(0, 10).map(([imei, count]) => ({ name: displayIMEI(imei), value: count }))}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ percent }: { percent?: number }) => percent ? `${(percent * 100).toFixed(0)}%` : ''}
                      outerRadius={80}
                      fill="#2563eb"
                      dataKey="value"
                    >
                      {stats.allIMEIsWithCounts.slice(0, 10).map((_, index) => (
                        <Cell key={`imei-${index}`} fill={
                          ['#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD',
                           '#1E40AF', '#4338CA', '#0F172A', '#64748B', '#BFDBFE'][index] || '#2563eb'
                        } />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [`${value} calls`, 'Count']}
                      labelFormatter={(label) => `IMEI: ${label}`}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }}
                      iconType="circle"
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* IMSI Pie Chart */}
              <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-slate-800 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-500">sim_card</span>
                  IMSI Distribution
                </h3>
                <ResponsiveContainer width="100%" height={350}>
                  <PieChart>
                    <Pie
                      data={stats.allIMSIsWithCounts.slice(0, 10).map(([imsi, count]) => ({ name: displayIMSI(imsi), value: count }))}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ percent }: { percent?: number }) => percent ? `${(percent * 100).toFixed(0)}%` : ''}
                      outerRadius={80}
                      fill="#2563eb"
                      dataKey="value"
                    >
                      {stats.allIMSIsWithCounts.slice(0, 10).map((_, index) => (
                        <Cell key={`imsi-${index}`} fill={
                          ['#0F172A', '#1E3A8A', '#1D4ED8', '#2563EB', '#3B82F6',
                           '#60A5FA', '#93C5FD', '#475569', '#64748B', '#BFDBFE'][index] || '#2563eb'
                        } />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [`${value} calls`, 'Count']}
                      labelFormatter={(label) => `IMSI: ${label}`}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }}
                      iconType="circle"
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Roaming Circle Bar Chart */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-slate-800 p-6 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-500">location_on</span>
                Calls by Roaming Circle
              </h3>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart
                  data={stats.roamingCircleData.slice(0, 10)}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" className="dark:stroke-slate-700" />
                  <XAxis
                    dataKey="name"
                    type="category"
                    stroke="#64748B"
                    className="dark:stroke-slate-400"
                    fontSize={12}
                  />
                  <YAxis
                    type="number"
                    stroke="#64748B"
                    className="dark:stroke-slate-400"
                    fontSize={12}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #dbe4f0',
                      borderRadius: '8px',
                      color: '#1E293B'
                    }}
                    formatter={(value) => [`${value} calls`, 'Count']}
                    labelStyle={{ color: '#1E293B' }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }}
                    iconType="rect"
                  />
                  <Bar
                    dataKey="value"
                    name="Calls"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
