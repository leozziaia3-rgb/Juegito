/**
 * SpeedwayWaypoints.ts - FIA Grade-1 Grand Prix Speedway Circuit Geometry
 * Features an 850m+ mega straight with DRS (355+ km/h), heavy braking into a left-right chicane,
 * sweeping high-speed curvone (255 km/h), medium-speed technical S-bends, a low-speed 2nd-gear hairpin,
 * and a wide-radius parabolic final bend leading back onto the main straight.
 */

import * as THREE from 'three';
import { SplinePoint } from '../../career/CircuitWaypoints';

export interface RawControlPoint {
  x: number;
  z: number;
  speed: number;
}

// Key track geometry control nodes calibrated for authentic F1 telemetry and racecraft
export const SPEEDWAY_CONTROL_NODES: RawControlPoint[] = [
  // --- SECTOR 1: MEGA STRAIGHT & CHICANE ---
  // Start/Finish Line at X=0, Z=-130
  { x: 0, z: -130, speed: 330 },
  { x: 100, z: -130, speed: 345 },
  { x: 220, z: -130, speed: 355 },
  { x: 330, z: -130, speed: 358 }, // Speed trap radar (358 km/h in 8th gear)
  { x: 375, z: -130, speed: 280 }, // Braking zone onset (100m board)
  { x: 395, z: -128, speed: 170 }, // Heavy trail-brake
  // Turn 1A: Chicane Left flick (85 km/h in 2nd gear)
  { x: 412, z: -110, speed: 85 },
  // Turn 1B: Chicane Right counter-flick (115 km/h)
  { x: 432, z: -70, speed: 115 },
  { x: 440, z: -35, speed: 175 },

  // --- SECTOR 2: CURVONE & MEDIUM/LOW SPEED SECTION ---
  // Turn 2: Curvone de Alta Velocidad (High-Downforce Arc, 255 km/h, 6th gear)
  { x: 438, z: 25, speed: 235 },
  { x: 415, z: 95, speed: 255 },
  { x: 365, z: 155, speed: 245 },
  // Turn 3: Technical Medium-Speed Left (155 km/h in 4th gear)
  { x: 300, z: 205, speed: 185 },
  { x: 235, z: 235, speed: 155 },
  // Turn 4: Technical Medium-Speed Right
  { x: 165, z: 245, speed: 165 },
  { x: 95, z: 240, speed: 180 },
  // Turn 5: Low-Speed Hairpin (Horquilla de Tracción, 85 km/h in 2nd gear)
  { x: 45, z: 235, speed: 125 },
  { x: 15, z: 215, speed: 85 },
  { x: 5, z: 175, speed: 95 },
  { x: 25, z: 140, speed: 140 },

  // --- SECTOR 3: ESSES & PARABÓLICA FINAL ---
  // Flowing Infield Esses (190 - 210 km/h in 5th gear)
  { x: -50, z: 135, speed: 195 },
  { x: -140, z: 130, speed: 210 },
  { x: -220, z: 105, speed: 195 },
  // Entry into Turn 6 & 7: La Gran Parabólica (Increasing radius slingshot)
  { x: -295, z: 75, speed: 180 },
  { x: -370, z: 30, speed: 195 },
  { x: -425, z: -30, speed: 215 },
  { x: -445, z: -85, speed: 235 },
  // Slingshot exit back onto the Mega Straight
  { x: -415, z: -128, speed: 265 },
  { x: -300, z: -130, speed: 295 },
  { x: -150, z: -130, speed: 315 },
];

/**
 * Builds the canonical smooth Catmull-Rom closed circuit spline for the Speedway.
 * Calibrated to approx. 2,780 meters with ~220 finely-discretized waypoints.
 */
export function buildSpeedwayWaypoints(): { waypoints: SplinePoint[]; totalLength: number } {
  const v3Points = SPEEDWAY_CONTROL_NODES.map((pt) => new THREE.Vector3(pt.x, 0, pt.z));
  const curve = new THREE.CatmullRomCurve3(v3Points, true, 'centripetal', 0.5);

  const numSamples = 240;
  const sampledPoints = curve.getSpacedPoints(numSamples);
  const totalLength = curve.getLength();

  // Map speed limits by projecting sampled points onto control nodes with distance weighting
  const splineWaypoints: SplinePoint[] = [];

  for (let i = 0; i < numSamples; i++) {
    const pt = sampledPoints[i];
    const nextPt = sampledPoints[(i + 1) % numSamples];

    // Find nearest 2 control nodes to interpolate speed limit smoothly
    let minDist1 = Infinity;
    let minDist2 = Infinity;
    let node1 = SPEEDWAY_CONTROL_NODES[0];
    let node2 = SPEEDWAY_CONTROL_NODES[1];

    for (let c = 0; c < SPEEDWAY_CONTROL_NODES.length; c++) {
      const node = SPEEDWAY_CONTROL_NODES[c];
      const d = Math.hypot(node.x - pt.x, node.z - pt.z);
      if (d < minDist1) {
        minDist2 = minDist1;
        node2 = node1;
        minDist1 = d;
        node1 = node;
      } else if (d < minDist2) {
        minDist2 = d;
        node2 = node;
      }
    }

    const totalWeight = minDist1 + minDist2 || 1;
    const w1 = 1 - (minDist1 / totalWeight);
    const w2 = 1 - w1;
    const interpolatedSpeed = Math.round(node1.speed * w1 + node2.speed * w2);

    const dx = nextPt.x - pt.x;
    const dz = nextPt.z - pt.z;
    const yaw = Math.atan2(dx, dz);

    splineWaypoints.push({
      x: Number(pt.x.toFixed(2)),
      z: Number(pt.z.toFixed(2)),
      speedLimitKmh: Math.max(75, Math.min(365, interpolatedSpeed)),
      yaw,
    });
  }

  return {
    waypoints: splineWaypoints,
    totalLength: Number(totalLength.toFixed(2)),
  };
}

const speedwayData = buildSpeedwayWaypoints();
export const SPEEDWAY_WAYPOINTS = speedwayData.waypoints;
export const SPEEDWAY_TOTAL_LENGTH = speedwayData.totalLength;
export const SPEEDWAY_RACE_PACE_SPEED = 59.8; // ~215.3 km/h average lap pace
