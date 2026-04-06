import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NormalizedTowerDump } from '../utils/towerDumpNormalization';

const MAX_MAP_INPUT_RECORDS = 20000;
const MAX_MAP_TOWERS = 3000;
const MAX_MAP_HANDOVERS = 4000;

// Fix for default markers in react-leaflet
const iconDefaultPrototype = L.Icon.Default.prototype as { _getIconUrl?: unknown };
delete iconDefaultPrototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface TowerMapProps {
  data: NormalizedTowerDump[];
  selectedTower?: string | null;
  onTowerSelect?: (cellId: string | null) => void;
  timeFilter?: {
    startDate?: string;
    endDate?: string;
  };
}

interface TowerLocation {
  cellId: string;
  lat: number;
  lng: number;
  description?: string;
  callCount: number;
}

interface HandoverRelationship {
  from: TowerLocation;
  to: TowerLocation;
  callCount: number;
}

const toCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const isValidLatLng = (lat: number, lng: number) =>
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

// Component to fit map bounds to markers
const FitBounds: React.FC<{ towers: TowerLocation[] }> = ({ towers }) => {
  const map = useMap();

  useEffect(() => {
    if (towers.length > 0) {
      const bounds = L.latLngBounds(towers.map(t => [t.lat, t.lng]));
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [towers, map]);

  return null;
};

export const TowerMap: React.FC<TowerMapProps> = ({
  data,
  selectedTower,
  onTowerSelect,
  timeFilter
}) => {
  const filteredData = useMemo(() => {
    let filtered = data;

    const startDate = timeFilter?.startDate;
    if (startDate) {
      filtered = filtered.filter(record =>
        record.call_date && record.call_date >= startDate
      );
    }

    const endDate = timeFilter?.endDate;
    if (endDate) {
      filtered = filtered.filter(record =>
        record.call_date && record.call_date <= endDate
      );
    }

    if (filtered.length > MAX_MAP_INPUT_RECORDS) {
      return filtered.slice(0, MAX_MAP_INPUT_RECORDS);
    }
    return filtered;
  }, [data, timeFilter?.startDate, timeFilter?.endDate]);

  // Extract unique towers from filtered data
  const towers = useMemo(() => {
    const towerMap = new Map<string, TowerLocation>();

    filteredData.forEach(record => {
      const firstLat = toCoordinate(record.first_cell_lat);
      const firstLng = toCoordinate(record.first_cell_long);
      const lastLat = toCoordinate(record.last_cell_lat);
      const lastLng = toCoordinate(record.last_cell_long);

      if (record.first_cell_id && firstLat !== null && firstLng !== null && isValidLatLng(firstLat, firstLng)) {
        const key = record.first_cell_id;
        if (!towerMap.has(key)) {
          towerMap.set(key, {
            cellId: record.first_cell_id,
            lat: firstLat,
            lng: firstLng,
            description: record.first_cell_desc || undefined,
            callCount: 0
          });
        }
        towerMap.get(key)!.callCount++;
      }

      if (
        record.last_cell_id &&
        record.last_cell_id !== record.first_cell_id &&
        lastLat !== null &&
        lastLng !== null &&
        isValidLatLng(lastLat, lastLng)
      ) {
        const key = record.last_cell_id;
        if (!towerMap.has(key)) {
          towerMap.set(key, {
            cellId: record.last_cell_id,
            lat: lastLat,
            lng: lastLng,
            description: record.last_cell_desc || undefined,
            callCount: 0
          });
        }
        towerMap.get(key)!.callCount++;
      }
    });

    return Array.from(towerMap.values())
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, MAX_MAP_TOWERS);
  }, [filteredData]);

  // Extract handover relationships
  const handovers = useMemo(() => {
    const handoverMap = new Map<string, HandoverRelationship>();

    filteredData.forEach(record => {
      const firstLat = toCoordinate(record.first_cell_lat);
      const firstLng = toCoordinate(record.first_cell_long);
      const lastLat = toCoordinate(record.last_cell_lat);
      const lastLng = toCoordinate(record.last_cell_long);

      if (record.first_cell_id && record.last_cell_id &&
          firstLat !== null && firstLng !== null &&
          lastLat !== null && lastLng !== null &&
          isValidLatLng(firstLat, firstLng) &&
          isValidLatLng(lastLat, lastLng) &&
          record.first_cell_id !== record.last_cell_id) {

        const fromTower: TowerLocation = {
          cellId: record.first_cell_id,
          lat: firstLat,
          lng: firstLng,
          description: record.first_cell_desc || undefined,
          callCount: 1
        };

        const toTower: TowerLocation = {
          cellId: record.last_cell_id,
          lat: lastLat,
          lng: lastLng,
          description: record.last_cell_desc || undefined,
          callCount: 1
        };

        const key = `${record.first_cell_id}-${record.last_cell_id}`;
        if (!handoverMap.has(key)) {
          handoverMap.set(key, {
            from: fromTower,
            to: toTower,
            callCount: 0
          });
        }
        handoverMap.get(key)!.callCount++;
      }
    });

    return Array.from(handoverMap.values())
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, MAX_MAP_HANDOVERS);
  }, [filteredData]);

  const maxCallCount = useMemo(
    () => towers.reduce((max, tower) => Math.max(max, tower.callCount), 1),
    [towers]
  );

  if (towers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
        <div className="text-center">
          <span className="material-symbols-outlined text-6xl mb-4">location_off</span>
          <h3 className="text-lg font-bold mb-2">No Tower Locations Available</h3>
          <p>Records don't contain latitude/longitude coordinates</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={[20.5937, 78.9629]} // Center of India
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        className="rounded-lg"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Fit bounds to towers */}
        <FitBounds towers={towers} />

        {/* Render handover lines */}
        {handovers.map((handover, index) => (
          <Polyline
            key={`handover-${index}`}
            positions={[
              [handover.from.lat, handover.from.lng],
              [handover.to.lat, handover.to.lng]
            ]}
            pathOptions={{
              color: '#10b981',
              weight: Math.min(1 + Math.log10(handover.callCount), 5),
              opacity: 0.7
            }}
          >
            <Popup>
              <div className="text-sm">
                <strong>Handover Route</strong><br/>
                From: {handover.from.cellId}<br/>
                To: {handover.to.cellId}<br/>
                Calls: {handover.callCount}
              </div>
            </Popup>
          </Polyline>
        ))}

        {towers.map((tower) => {
          const normalized = tower.callCount / Math.max(1, maxCallCount);
          const radius = Math.max(5, Math.min(16, 5 + normalized * 11));
          const isSelected = selectedTower === tower.cellId;
          return (
            <CircleMarker
              key={`${tower.cellId}-${tower.lat}-${tower.lng}`}
              center={[tower.lat, tower.lng]}
              radius={radius}
              pathOptions={{
                color: isSelected ? '#ef4444' : '#1d4ed8',
                fillColor: isSelected ? '#ef4444' : '#3b82f6',
                fillOpacity: 0.7,
                weight: 1.5
              }}
              eventHandlers={{
                click: () => onTowerSelect?.(tower.cellId)
              }}
            >
              <Popup>
                <div className="text-sm">
                  <strong>Cell ID:</strong> {tower.cellId}<br/>
                  {tower.description && <><strong>Description:</strong> {tower.description}<br/></>}
                  <strong>Total Calls:</strong> {tower.callCount}<br/>
                  <strong>Coordinates:</strong> {tower.lat.toFixed(6)}, {tower.lng.toFixed(6)}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend */}
      <div className="absolute top-4 right-4 bg-white dark:bg-slate-800 p-3 rounded-lg shadow-lg z-[1000]">
        <h4 className="text-sm font-bold mb-2 text-slate-900 dark:text-white">Legend</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span className="text-slate-700 dark:text-slate-300">Tower Location</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-green-500"></div>
            <span className="text-slate-700 dark:text-slate-300">Handover Route</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <span className="text-slate-700 dark:text-slate-300">Selected Tower</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Circle size indicates call volume
        </div>
        {(data.length > filteredData.length || towers.length >= MAX_MAP_TOWERS || handovers.length >= MAX_MAP_HANDOVERS) && (
          <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Large dataset detected. Map view is capped for responsiveness.
          </div>
        )}
      </div>
    </div>
  );
};
