"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: [number, number] = [-6.2, 106.8];
const DEFAULT_CHECKIN_RADIUS_M = 100;

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Props = {
  lat: number | null;
  lng: number | null;
  radiusMeters: number | null;
  readOnly?: boolean;
  onChange: (coords: { lat: number; lng: number }) => void;
};

function MapViewSync({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat === null || lng === null) return;
    const z = map.getZoom();
    map.setView([lat, lng], z < 12 ? 15 : z);
  }, [lat, lng, map]);
  return null;
}

function MapClickPlace({
  readOnly,
  onChange,
}: {
  readOnly: boolean;
  onChange: (coords: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      if (readOnly) return;
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function MapInvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 100);
    return () => window.clearTimeout(t);
  }, [map]);
  return null;
}

export default function StoreMapPicker({
  lat,
  lng,
  radiusMeters,
  readOnly = false,
  onChange,
}: Props) {
  const hasPin = lat !== null && lng !== null;
  const center: [number, number] = hasPin ? [lat, lng] : DEFAULT_CENTER;
  const zoom = hasPin ? 15 : 6;
  const circleRadius =
    radiusMeters === null || radiusMeters === undefined
      ? DEFAULT_CHECKIN_RADIUS_M
      : radiusMeters;

  const position = useMemo(
    () => (hasPin ? L.latLng(lat, lng) : null),
    [hasPin, lat, lng],
  );

  return (
    <div className="overflow-hidden rounded-md border h-[280px] w-full relative z-0 isolate">
      <MapContainer
        center={center}
        zoom={zoom}
        className="h-full w-full !bg-muted/30"
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
        dragging={!readOnly}
        doubleClickZoom={!readOnly}
        zoomControl={!readOnly}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInvalidateSize />
        <MapViewSync lat={lat} lng={lng} />
        <MapClickPlace readOnly={readOnly} onChange={onChange} />
        {position && (
          <>
            <Marker
              position={position}
              icon={markerIcon}
              draggable={!readOnly}
              eventHandlers={{
                dragend: (e) => {
                  const pos = e.target.getLatLng();
                  onChange({ lat: pos.lat, lng: pos.lng });
                },
              }}
            />
            {circleRadius > 0 && (
              <Circle
                center={position}
                radius={circleRadius}
                pathOptions={{
                  color: "#2563eb",
                  fillColor: "#2563eb",
                  fillOpacity: 0.12,
                  weight: 1.5,
                }}
              />
            )}
          </>
        )}
      </MapContainer>
    </div>
  );
}
