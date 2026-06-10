"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker, Popup } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { haversineKm, formatDistance } from "@/lib/geo";

const TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ??
  "pk.eyJ1IjoicHVsc2UtbWFwIiwiYSI6ImNrMDBkZW1vMDAwMDAwMDAifQ.AAAAAAAAAAAAAAAAAAAAAA";

// Must match --beat in globals.css so dot rings and the rest of the UI share
// one rhythm. The whole planet pulses on this clock.
const BEAT_MS = 2400;

// On-palette tint per id: hue stays in the cyan→violet→magenta band so the map
// reads as one coherent organism instead of a confetti of random colors.
function dotColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = 175 + (Math.abs(hash) % 150); // 175–325
  return `hsl(${hue}, 90%, 66%)`;
}

// Geodesic (great-circle) polyline between two [lng,lat] points via slerp, so
// the connection beam curves naturally across the globe.
function geodesic(
  a: [number, number],
  b: [number, number],
  steps = 96,
): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const [lng1, lat1] = [a[0] * toRad, a[1] * toRad];
  const [lng2, lat2] = [b[0] * toRad, b[1] * toRad];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );
  if (d === 0) return [a, b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y =
      A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([
      Math.atan2(y, x) * toDeg,
      Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
    ]);
  }
  return pts;
}

// Stepped dash patterns → a bright pulse that travels along the beam.
const DASH_SEQUENCE = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
  activePeerId,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
  activePeerId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [ready, setReady] = useState(false);

  // Live values read inside once-bound handlers.
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  const meRef = useRef(me);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
    meRef.current = me;
  });

  // ── Init the globe once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "globe",
        center: me ? [me.lng, me.lat] : [12, 25],
        zoom: me ? 3.4 : 1.55,
        attributionControl: true,
        logoPosition: "bottom-right",
      });

      map.on("style.load", () => {
        // Deep-space atmosphere tuned to the palette.
        map.setFog({
          color: "rgb(11, 16, 32)",
          "high-color": "rgb(28, 40, 80)",
          "horizon-blend": 0.06,
          "space-color": "rgb(3, 4, 12)",
          "star-intensity": 0.5,
        });
      });
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── "You are here" beacon ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.innerHTML = `<span class="pulse-me-label">you</span>`;
        meMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // ── Reconcile peer dots (phase-locked heartbeat + hover distance popup) ────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.className = "pulse-dot";
          el.style.setProperty("--dot", dotColor(peer.id));
          // Phase-lock every dot to one shared clock → planet-wide unison.
          el.style.setProperty("--phase", `-${Date.now() % BEAT_MS}ms`);
          el.setAttribute("aria-label", "Stranger — tap to connect");

          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
          });
          el.addEventListener("mouseenter", () => {
            const m = meRef.current;
            const dist = m
              ? formatDistance(haversineKm(m.lat, m.lng, peer.lat, peer.lng))
              : "";
            const label = canConnectRef.current
              ? "tap to connect"
              : "busy";
            popupRef.current?.remove();
            popupRef.current = new mapboxgl.Popup({
              closeButton: false,
              closeOnClick: false,
              offset: 16,
              className: "pulse-popup",
            })
              .setLngLat([peer.lng, peer.lat])
              .setHTML(
                `<span class="pp-dist">${dist}</span><span class="pp-cta">${label}</span>`,
              )
              .addTo(map);
          });
          el.addEventListener("mouseleave", () => {
            popupRef.current?.remove();
            popupRef.current = null;
          });

          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          markers.set(peer.id, marker);
        } else {
          marker.setLngLat([peer.lng, peer.lat]);
        }
        marker.getElement().classList.toggle("is-busy", peer.busy);
      }

      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready]);

  // ── Connection beam — animated geodesic arc to the active peer ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const peer = activePeerId
      ? peers.find((p) => p.id === activePeerId)
      : undefined;
    let raf = 0;

    const removeBeam = () => {
      if (raf) cancelAnimationFrame(raf);
      for (const id of ["beam-dash", "beam-glow"]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource("beam")) map.removeSource("beam");
    };

    if (!peer || !me) {
      removeBeam();
      return;
    }

    const line = geodesic([me.lng, me.lat], [peer.lng, peer.lat]);
    const data = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: line },
    };

    const src = map.getSource("beam") as
      | { setData: (d: typeof data) => void }
      | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource("beam", { type: "geojson", data, lineMetrics: true });
      map.addLayer({
        id: "beam-glow",
        type: "line",
        source: "beam",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#45e9ff",
          "line-width": 5,
          "line-opacity": 0.22,
          "line-blur": 6,
        },
      });
      map.addLayer({
        id: "beam-dash",
        type: "line",
        source: "beam",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#bfffff",
          "line-width": 2,
          "line-opacity": 0.95,
        },
      });
    }

    let step = 0;
    let last = 0;
    const animate = (t: number) => {
      if (t - last > 60) {
        const next = Math.floor((t / 60) % DASH_SEQUENCE.length);
        if (next !== step) {
          step = next;
          if (map.getLayer("beam-dash")) {
            map.setPaintProperty(
              "beam-dash",
              "line-dasharray",
              DASH_SEQUENCE[step],
            );
          }
        }
        last = t;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return removeBeam;
  }, [activePeerId, peers, me, ready]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full bg-abyss" />

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="glass max-w-md rounded-2xl p-4 text-sm text-ink-dim">
            Set <code className="text-cyan">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the map.
          </p>
        </div>
      )}
    </div>
  );
}
