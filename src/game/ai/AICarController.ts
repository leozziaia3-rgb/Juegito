/**
 * AICarController.ts - Professional Multi-Car AI Racing Pilot with Real Rigid Body Physics
 * Controls autonomous F1 cars with dynamic racing lines, long-range predictive braking,
 * realistic Pacejka physics, structural damage simulation, multi-compound pit stop strategies,
 * 9-ray multibeam radar perception, active slipstream slingshot overtaking, switchback counters,
 * proactive defense, and emergency in-lap pit stop protocols.
 */

import * as THREE from 'three';
import { CarModel } from '../models/CarModel';
import { TeamLiveryConfig, RaceDifficulty, DriverLeaderboardEntry } from '../career/CareerTypes';
import { TireCompoundType, TIRE_COMPOUNDS } from '../physics/TireCompound';
import { ParticleSystem } from '../particles/ParticleSystem';
import { DamageState, VehiclePhysics, CarInputs } from '../physics/VehiclePhysics';
import { AIRaycastPerception, VehicleObstacle, TacticalManeuver } from './AIRaycastPerception';
import {
  SplinePoint,
  SHARED_CIRCUIT_WAYPOINTS,
  CIRCUIT_TOTAL_LENGTH,
  CIRCUIT_RACE_PACE_SPEED,
  formatF1TimeGap,
} from '../career/CircuitWaypoints';
import { ICircuitDefinition } from '../circuits/ICircuit';

export type { SplinePoint };

export type AIRacingState = 'RACING' | 'ATTACKING' | 'DEFENDING' | 'SWITCHBACK' | 'IN_LAP_EMERGENCY';

function getNearestAngle(currentAngle: number, targetAngle: number): number {
  let diff = (targetAngle - currentAngle) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return currentAngle + diff;
}

export class AICarController {
  public team: TeamLiveryConfig;
  public carModel: CarModel;
  public difficulty: RaceDifficulty;

  // Real Vehicle Physics Engine for this AI Car
  public physics: VehiclePhysics;

  // Analytical 9-beam Radar Raycasting Sensor
  public radar = new AIRaycastPerception();

  // Current Tactical Racecraft State
  public raceState: AIRacingState = 'RACING';
  public currentManeuver: TacticalManeuver = 'hold';

  // F1 Driver Personality & Racecraft Attributes
  public aggression: number = 0.88;
  public brakeSkill: number = 1.05;
  public trailBrakeAbility: number = 0.90;
  public defenseSkill: number = 0.88;

  // Track position & metrics
  public distanceAlongTrack: number = 0; // 0 to TrackLength
  public trackProgressNormalized: number = 0; // 0.0 to 1.0 per lap
  public currentLap: number = 1;
  public currentSector: number = 0;
  public lateralOffset: number = 0; // Smooth offset from optimal racing line (-3.5 to +3.5)
  public targetLateralOffset: number = 0;

  // Starting Grid Anchor & Lane Discipline
  public gridStartX: number = -26.0;
  public gridStartZ: number = -132.0;
  public initialLaneOffset: number = 0;

  // Cached vector for external systems
  public position = new THREE.Vector3();

  // Starting Procedure & Reaction Time
  public hasReactedToLights: boolean = false;
  public reactionTimer: number = 0;

  // Autonomous Stuck Detection & Recovery State Machine
  public stuckTimer: number = 0;
  public recoveryPhase: 'none' | 'reverse' | 'turn_in' = 'none';
  public recoveryTimer: number = 0;

  // Active Overtaking & Slipstream
  public isOvertaking: boolean = false;
  public overtakeTimer: number = 0;
  public slipstreamActive: boolean = false;
  public switchbackTimer: number = 0;
  public defenseTimer: number = 0;

  // Tire Compound & Degradation
  public currentCompound: TireCompoundType = 'medium';
  public nextPitCompound: TireCompoundType = 'hard';
  public compoundsUsed: Set<TireCompoundType> = new Set();
  public pitStopsCount: number = 0;

  // Emergency Damage & Pit Stop State
  public isInEmergencyPitLap: boolean = false;
  public isInPitLane: boolean = false;
  public isStationaryInBox: boolean = false;
  public hasServicedInBox: boolean = false;
  public pitProgress: number = 0;
  public pitTimer: number = 0;
  public readonly pitDuration: number = 4.8; // Calibrated pit service duration
  public plannedPitLaps: number[] = [];
  public hasPlannedStops: boolean = false;

  // Timing & Telemetry
  public totalLaps: number = 20;
  public currentLapTime: number = 0;
  public lastLapTime: number | null = null;
  public bestLapTime: number | null = null;
  public totalRaceTime: number = 0;
  public isFinished: boolean = false;
  public finishTime: number = 0;

  // Track geometry metrics
  public totalTrackLength: number = 974.76;
  public waypoints: SplinePoint[] = [];
  public activeCircuit?: ICircuitDefinition;
  private lastClosestIdx: number = 0;
  private static _obstaclesPool: VehicleObstacle[] = [];

  constructor(
    team: TeamLiveryConfig,
    difficulty: RaceDifficulty = 'hard',
    startingCompound: TireCompoundType = 'medium',
    totalRaceLaps: number = 20
  ) {
    this.team = team;
    this.difficulty = difficulty;
    this.totalLaps = totalRaceLaps;
    this.currentCompound = startingCompound;
    this.compoundsUsed.add(startingCompound);
    this.carModel = new CarModel(team, true);
    this.carModel.setTireCompoundVisuals(startingCompound);

    // Initialize dedicated vehicle physics instance
    this.physics = new VehiclePhysics(-26.0, -132.0, Math.PI / 2);
    this.physics.setTireCompound(startingCompound);

    // Calibrate Authentic Driver Personalities & World-Class F1 Racecraft Styles
    if (team.id === 'scuderia') {
      // Charles Leclerc: Ultra-aggressive, fearless inside divebomber, blistering apex pace
      this.aggression = 0.96;
      this.brakeSkill = 1.15;
      this.trailBrakeAbility = 0.94;
      this.defenseSkill = 0.88;
    } else if (team.id === 'emerald') {
      // Fernando Alonso: Tactical master, legendary defensive positioning & switchback counters
      this.aggression = 0.98;
      this.brakeSkill = 1.16;
      this.trailBrakeAbility = 0.98;
      this.defenseSkill = 0.98;
    } else if (team.id === 'papaya') {
      // Lando Norris: High mid-corner momentum, calculated slingshots, smooth tire management
      this.aggression = 0.90;
      this.brakeSkill = 1.10;
      this.trailBrakeAbility = 0.92;
      this.defenseSkill = 0.86;
    } else if (team.id === 'silver_arrow') {
      // George Russell: Strong slipstream drafting, assertive defending, high straight-line discipline
      this.aggression = 0.92;
      this.brakeSkill = 1.12;
      this.trailBrakeAbility = 0.90;
      this.defenseSkill = 0.92;
    } else {
      this.aggression = 0.88;
      this.brakeSkill = 1.06;
      this.trailBrakeAbility = 0.86;
      this.defenseSkill = 0.85;
    }

    this.waypoints = SHARED_CIRCUIT_WAYPOINTS;
    this.totalTrackLength = CIRCUIT_TOTAL_LENGTH;
    this.planPitStrategy(totalRaceLaps);
  }

  /**
   * Sets the active circuit topology and waypoints for the AI
   */
  public setCircuit(circuit: ICircuitDefinition): void {
    this.activeCircuit = circuit;
    this.waypoints = circuit.waypoints;
    this.totalTrackLength = circuit.totalLength;
  }

  public get speedKmh(): number {
    return Math.abs(this.physics.speed) * 3.6;
  }

  public get speedMs(): number {
    return Math.abs(this.physics.speed);
  }

  public get yaw(): number {
    return this.physics.yaw;
  }

  public get damage(): DamageState {
    return this.physics.damage;
  }

  public get tireWear(): [number, number, number, number] {
    return this.physics.tireWear;
  }

  /**
   * Plans realistic AI pit stop strategy based on race length and compound rules
   */
  public planPitStrategy(totalLaps: number): void {
    this.hasPlannedStops = true;
    if (totalLaps === 9) {
      if (this.currentCompound === 'soft') {
        this.plannedPitLaps = [4];
        this.nextPitCompound = 'medium';
      } else {
        this.plannedPitLaps = [];
      }
    } else if (totalLaps === 20) {
      const pitLap = 8 + Math.floor(Math.random() * 4);
      this.plannedPitLaps = [pitLap];
      if (this.currentCompound === 'soft') {
        this.nextPitCompound = 'medium';
      } else if (this.currentCompound === 'medium') {
        this.nextPitCompound = 'hard';
      } else {
        this.nextPitCompound = 'soft';
      }
    } else {
      this.plannedPitLaps = [16, 33];
      this.nextPitCompound = this.currentCompound === 'soft' ? 'medium' : 'hard';
    }
  }

  /**
   * Sets vehicle cleanly on its designated F1 Starting Grid slot (1 to 5)
   */
  public setGridPosition(gridSlot: number): void {
    let gridX = -18.0;
    let gridZ = -132.0;
    let gridYaw = Math.PI / 2;
    const isLeft = gridSlot % 2 === 1;

    if (this.activeCircuit?.gridSlots) {
      const slotPose = this.activeCircuit.gridSlots.ai(gridSlot);
      gridX = slotPose.x;
      gridZ = slotPose.z;
      gridYaw = slotPose.yaw;
    } else {
      gridX = -18.0 - (gridSlot - 1) * 8.0;
      gridZ = isLeft ? -128.0 : -132.0;
      gridYaw = Math.PI / 2;
    }

    this.physics.reset(gridX, gridZ, gridYaw);
    this.gridStartX = gridX;
    this.gridStartZ = gridZ;
    this.initialLaneOffset = isLeft ? 2.0 : -2.0;
    this.lateralOffset = this.initialLaneOffset;
    this.targetLateralOffset = this.initialLaneOffset;

    this.position.set(gridX, 0.35, gridZ);
    this.carModel.group.position.copy(this.position);
    this.carModel.group.rotation.set(0, gridYaw, 0);

    const startProgressX = gridX - (-92.0);
    this.distanceAlongTrack = Math.max(0, startProgressX);
    this.trackProgressNormalized = this.distanceAlongTrack / this.totalTrackLength;

    // F1 Starting Reaction Times (Hard mode: 0.08s - 0.12s)
    const reactionBase = {
      easy: 0.28,
      medium: 0.18,
      hard: 0.08,
    }[this.difficulty];
    this.reactionTimer = reactionBase + Math.random() * 0.05;
    this.hasReactedToLights = false;
    this.stuckTimer = 0;
    this.recoveryPhase = 'none';
    this.isInEmergencyPitLap = false;
    this.isInPitLane = false;
    this.isStationaryInBox = false;
    this.hasServicedInBox = false;
    this.isOvertaking = false;
    this.overtakeTimer = 0;
    this.raceState = 'RACING';
  }

  /**
   * Called when starting lights go out
   */
  public onLightsOut(): void {
    this.hasReactedToLights = false;
  }

  /**
   * Main AI Update Loop: Autonomous Master Driver AI with Multibeam Raycasting, G-G Trail Braking,
   * Slingshot Overtakes, Switchback Counters, Defense, and Emergency In-Lap Pit Stops
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerSpeedKmh: number,
    otherAiCars: AICarController[],
    particles: ParticleSystem,
    isRaceActive: boolean,
    isControlsLocked: boolean = false
  ): void {
    // 1. Grid Locked State (Revving in place during 5 Red Lights sequence)
    if (!isRaceActive || isControlsLocked) {
      this.physics.speed = 0;
      this.physics.lateralSpeed = 0;
      this.physics.angularVelocity = 0;
      this.physics.position.x = this.gridStartX;
      this.physics.position.y = 0.35;
      this.physics.position.z = this.gridStartZ;
      this.physics.yaw = Math.PI / 2;
      this.physics.gear = 1;

      this.physics.update(dt, {
        throttle: 0.65 + Math.sin(performance.now() * 0.008) * 0.25, // aggressive revving
        brake: 1.0,
        steering: 0,
        handbrake: true,
      });

      this.physics.position.x = this.gridStartX;
      this.physics.position.y = 0.35;
      this.physics.position.z = this.gridStartZ;
      this.physics.speed = 0;
      this.physics.lateralSpeed = 0;
      this.physics.angularVelocity = 0;
      this.physics.yaw = Math.PI / 2;
      this.physics.gear = 1;

      this.position.set(this.gridStartX, 0.35, this.gridStartZ);
      this.carModel.group.position.copy(this.position);
      this.carModel.group.rotation.set(0, Math.PI / 2, 0);
      this.carModel.update(0, this.physics.wheelRotations, 1.0, 0, this.physics.damage, false, this.physics.rpm);
      return;
    }

    // Reaction delay after lights out before launch
    if (!this.hasReactedToLights) {
      this.reactionTimer -= dt;
      if (this.reactionTimer <= 0) {
        this.hasReactedToLights = true;
      } else {
        this.physics.speed = 0;
        this.physics.lateralSpeed = 0;
        this.physics.position.x = this.gridStartX;
        this.physics.position.y = 0.35;
        this.physics.position.z = this.gridStartZ;
        this.physics.yaw = Math.PI / 2;
        this.physics.gear = 1;

        this.physics.update(dt, { throttle: 0.95, brake: 1.0, steering: 0, handbrake: true });

        this.physics.position.x = this.gridStartX;
        this.physics.position.y = 0.35;
        this.physics.position.z = this.gridStartZ;
        this.physics.speed = 0;
        this.physics.lateralSpeed = 0;
        this.physics.gear = 1;

        this.position.set(this.gridStartX, 0.35, this.gridStartZ);
        this.carModel.group.position.copy(this.position);
        this.carModel.group.rotation.set(0, Math.PI / 2, 0);
        this.carModel.update(0, this.physics.wheelRotations, 1.0, 0, this.physics.damage, false, this.physics.rpm);
        return;
      }
    }

    // 2. Autonomous Collision Recovery State Machine (Reversing & Turn-in)
    if (this.recoveryPhase !== 'none') {
      if (this.recoveryPhase === 'reverse') {
        this.recoveryTimer -= dt;
        this.physics.speed = -5.5;
        this.physics.gear = -1;
        this.physics.update(dt, {
          throttle: 0,
          brake: 0.85,
          steering: -Math.sign(this.physics.steerAngle || 1) * 0.95,
          handbrake: false,
        });

        if (this.recoveryTimer <= 0) {
          this.recoveryPhase = 'turn_in';
          this.recoveryTimer = 0.8;
          this.physics.gear = 1;
          this.physics.speed = 1.5;
        }
      } else if (this.recoveryPhase === 'turn_in') {
        this.recoveryTimer -= dt;
        this.physics.gear = 1;
        this.physics.update(dt, {
          throttle: 0.75,
          brake: 0,
          steering: Math.sign(this.physics.steerAngle || 1) * 0.85,
          handbrake: false,
        });

        if (this.recoveryTimer <= 0 || this.speedKmh > 24.0) {
          this.recoveryPhase = 'none';
          this.stuckTimer = 0;
        }
      }

      this.position.set(this.physics.position.x, this.physics.position.y, this.physics.position.z);
      this.carModel.group.position.copy(this.position);
      this.carModel.group.rotation.set(0, this.physics.yaw, this.physics.roll);
      this.carModel.update(
        this.physics.visualSteerAngle,
        this.physics.wheelRotations,
        0,
        this.speedKmh,
        this.physics.damage,
        this.physics.isShifting,
        this.physics.rpm
      );
      return;
    }

    // 3. Pit Lane Trajectory & Timed Stop
    if (this.isInPitLane) {
      this.updatePitLane(dt, particles);
      return;
    }

    const myX = this.physics.position.x;
    const myZ = this.physics.position.z;
    const mySpeed = Math.abs(this.physics.speed);
    const mySpeedKmh = mySpeed * 3.6;

    // Check emergency damage: Wing loose/detached, crumple, engine degradation, puncture, or chassis wear
    const hasCriticalDamage =
      this.physics.damage.wingLoose ||
      this.physics.damage.frontWingLeftDetached ||
      this.physics.damage.frontWingRightDetached ||
      this.physics.damage.frontWingLeftUpperFlapDetached ||
      this.physics.damage.frontWingRightUpperFlapDetached ||
      this.physics.damage.endplateLeftDetached ||
      this.physics.damage.endplateRightDetached ||
      this.physics.damage.rearWingLeftDetached ||
      this.physics.damage.rearWingRightDetached ||
      this.physics.damage.frontCrumple > 0.18 ||
      this.physics.damage.rearCrumple > 0.20 ||
      this.physics.damage.frontWingLeftDamage > 0.30 ||
      this.physics.damage.frontWingRightDamage > 0.30 ||
      this.physics.damage.wingDamageAmount > 0.28 ||
      this.physics.damage.engineHealth < 85 ||
      this.physics.isPunctured.some((p) => p) ||
      this.physics.damage.overallHealth < 80 ||
      this.physics.damage.suspensionLeft < 80 ||
      this.physics.damage.suspensionRight < 80;

    const needsPit =
      hasCriticalDamage ||
      this.plannedPitLaps.includes(this.currentLap) ||
      (this.physics.tireWear[0] > 68 && this.pitStopsCount < 2);

    if (hasCriticalDamage) {
      this.isInEmergencyPitLap = true;
      this.raceState = 'IN_LAP_EMERGENCY';
    }

    // Dynamic Pit Lane Entry Navigation using active circuit topology
    const pz = this.activeCircuit?.pitZone || { minX: -65.0, maxX: 45.0, minZ: -120.0, maxZ: -106.0 };

    if (needsPit && !this.isInPitLane) {
      // In final sector or approaching main straight, proactively move to the pit entry side
      if ((this.currentSector === 4 || (myZ < -85.0 && myX < 15.0)) && myX < 5.0) {
        this.targetLateralOffset = 3.6; // Pit entry corridor lane
      }

      // Detect pit entry corridor penetration
      const inPitCorridor = myX >= (pz.minX - 16.0) && myX <= (pz.minX + 38.0) && myZ >= (pz.minZ - 8.0) && myZ <= (pz.maxZ + 5.0);
      if (inPitCorridor) {
        this.isInPitLane = true;
        this.isStationaryInBox = false;
        this.hasServicedInBox = false;
        this.pitTimer = 0;
        this.physics.position.z = -119.0;
        this.plannedPitLaps = this.plannedPitLaps.filter((l) => l !== this.currentLap);
        this.isInEmergencyPitLap = false;
      }
    }

    // 4. Autonomous Pilot Navigation (Pure Pursuit Waypoint Tracker with Localized Window Search)
    const numPts = this.waypoints.length;
    let closestIdx = this.lastClosestIdx;
    let closestDistSq = Infinity;

    // Check 22 points ahead and 4 behind current position (O(1) localized search)
    for (let offset = -4; offset <= 22; offset++) {
      const idx = (this.lastClosestIdx + offset + numPts) % numPts;
      const pt = this.waypoints[idx];
      const dx = pt.x - myX;
      const dz = pt.z - myZ;
      const dsq = dx * dx + dz * dz;
      if (dsq < closestDistSq) {
        closestDistSq = dsq;
        closestIdx = idx;
      }
    }

    // Safety fallback
    if (closestDistSq > 1600) {
      for (let i = 0; i < numPts; i++) {
        const pt = this.waypoints[i];
        const dx = pt.x - myX;
        const dz = pt.z - myZ;
        const dsq = dx * dx + dz * dz;
        if (dsq < closestDistSq) {
          closestDistSq = dsq;
          closestIdx = i;
        }
      }
    }
    this.lastClosestIdx = closestIdx;

    // Lookahead Distance: 14m at low speed, scales smoothly up to 34m at top speed for rock-solid stability
    const lookaheadDist = THREE.MathUtils.clamp(14.0 + mySpeed * 0.28, 14.0, 34.0);
    let accumulatedDist = 0;
    let targetIdx = closestIdx;

    while (accumulatedDist < lookaheadDist) {
      const nextIdx = (targetIdx + 1) % numPts;
      const p1 = this.waypoints[targetIdx];
      const p2 = this.waypoints[nextIdx];
      const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      accumulatedDist += segLen;
      targetIdx = nextIdx;
    }

    const targetPt = this.waypoints[targetIdx];

    // Compute tangent & normal at target waypoint for lateral offset
    const nextPt = this.waypoints[(targetIdx + 1) % numPts];
    const tDx = nextPt.x - targetPt.x;
    const tDz = nextPt.z - targetPt.z;
    const tLen = Math.hypot(tDx, tDz) || 1;
    const normX = -tDz / tLen;
    const normZ = tDx / tLen;

    // 5. Multibeam Radar Raycasting Perception & Tactical Overtaking (Zero GC Allocation)
    const isStartingStraight = this.currentLap === 1 && myX < 65 && myZ < -115;
    const baseOffset = isStartingStraight ? this.initialLaneOffset : 0;

    // Static obstacles pool reuse
    const obstacles = AICarController._obstaclesPool;
    obstacles.length = 0;
    obstacles.push({
      id: 'player',
      x: playerPos.x,
      z: playerPos.z,
      yaw: this.physics.yaw,
      speedMs: playerSpeedKmh / 3.6,
      length: 4.8,
      width: 2.0,
    });

    let amLeading = true;
    for (let o = 0; o < otherAiCars.length; o++) {
      const other = otherAiCars[o];
      if (other === this) continue;
      if (other.distanceAlongTrack > this.distanceAlongTrack && other.currentLap >= this.currentLap) {
        amLeading = false;
      }
      obstacles.push({
        id: other.team.id,
        x: other.physics.position.x,
        z: other.physics.position.z,
        yaw: other.physics.yaw,
        speedMs: other.physics.speed,
        length: 4.8,
        width: 2.0,
      });
    }

    // Tarmac width available
    const halfTrackWidth = 7.6;
    const availLeft = Math.max(1.2, halfTrackWidth + this.lateralOffset);
    const availRight = Math.max(1.2, halfTrackWidth - this.lateralOffset);

    // Cast 9-beam radar array against all track entities
    const radar = this.radar.castRays(myX, myZ, this.physics.yaw, mySpeed, obstacles, availLeft, availRight);

    // Evaluate tactical racecraft state
    const isApproachingCorner = targetPt.speedLimitKmh < 220;
    const isExitingCorner = targetPt.speedLimitKmh >= 220 && mySpeedKmh < 260;

    const overtakeDecision = this.radar.evaluateOvertake(
      this.lateralOffset,
      this.aggression,
      isApproachingCorner,
      isExitingCorner,
      amLeading
    );

    this.currentManeuver = overtakeDecision.maneuver;

    // Handle Emergency In-Lap Mode: Move out of optimal line if fast cars are behind
    if (this.isInEmergencyPitLap) {
      this.raceState = 'IN_LAP_EMERGENCY';
      // Yield racing line to faster traffic, pull to pit entry corridor lane
      this.targetLateralOffset = 3.4;
    } else if (overtakeDecision.shouldOvertake) {
      this.targetLateralOffset = overtakeDecision.targetOffset;
      this.isOvertaking = true;
      this.overtakeTimer = 2.2;
      this.raceState = overtakeDecision.canSwitchback ? 'SWITCHBACK' : 'ATTACKING';
    } else if (overtakeDecision.defendThreat) {
      this.targetLateralOffset = overtakeDecision.targetOffset;
      this.raceState = 'DEFENDING';
      this.defenseTimer = 1.4;
    } else if (this.overtakeTimer > 0) {
      this.overtakeTimer -= dt;
      if (this.overtakeTimer <= 0) {
        this.isOvertaking = false;
        this.targetLateralOffset = baseOffset;
        this.raceState = 'RACING';
      }
    } else {
      this.targetLateralOffset = baseOffset;
      this.raceState = 'RACING';
    }

    // Apply continuous Artificial Potential Field (APF) elastic lateral repulsion
    this.targetLateralOffset = this.radar.computeRepulsionOffset(
      this.targetLateralOffset,
      availLeft,
      availRight
    );

    // Dynamic lateral shift speed: Rapid jink out of slipstream, smooth line holding elsewhere
    let lateralShiftSpeed = 4.8 * this.aggression;
    if (overtakeDecision.isSideBySide) {
      lateralShiftSpeed = 6.8;
    } else if (overtakeDecision.maneuver.startsWith('slingshot') || overtakeDecision.maneuver === 'switchback_cut') {
      lateralShiftSpeed = 7.2; // Instant aggressive jink
    }

    this.lateralOffset += (this.targetLateralOffset - this.lateralOffset) * Math.min(1.0, lateralShiftSpeed * dt);

    // Final target destination point
    const destX = targetPt.x + normX * this.lateralOffset;
    const destZ = targetPt.z + normZ * this.lateralOffset;

    // 6. Steering Controller (PD Heading Tracker with Dynamic Speed Compensation)
    const targetAngle = Math.atan2(destX - myX, destZ - myZ);
    let angleDiff = targetAngle - this.physics.yaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const steerP = 3.10;
    const steerD = 0.26;
    const steeringInput = THREE.MathUtils.clamp(
      angleDiff * steerP - this.physics.angularVelocity * steerD,
      -1.0,
      1.0
    );

    // 7. Physics-based Long-Range Predictive Braking System & Dynamic Curvature Geometry
    // Real F1 Hard Difficulty pace factor (1.08 = true professional F1 pole pace)
    const diffSpeedScale = {
      easy: 0.90,
      medium: 0.98,
      hard: 1.08,
    }[this.difficulty];

    const compoundConfig = TIRE_COMPOUNDS[this.currentCompound] || TIRE_COMPOUNDS.soft;
    const wearP = Math.min(0.35, (this.physics.tireWear[0] / 100) * 0.35);
    const gripFactor = compoundConfig.gripMultiplier * (1.0 - wearP);
    const engineHealthFactor = Math.pow(Math.max(0.1, this.physics.damage.engineHealth / 100), 0.35);

    // Limp factor during emergency in-lap
    const emergencyHealthFactor = this.isInEmergencyPitLap ? 0.65 : 1.0;

    // Active Slipstream (Rebufo): Detected by forward center beam within 38m
    this.slipstreamActive = false;
    let slipstreamBonus = 1.0;
    if (radar.center.hit && radar.center.distance < 38.0 && mySpeed > 26.0 && !overtakeDecision.isSideBySide) {
      this.slipstreamActive = true;
      const towEfficiency = 1.0 - (radar.center.distance / 38.0);
      slipstreamBonus = 1.0 + towEfficiency * 0.20; // Up to +20% acceleration in the tow
    }

    // Dynamic braking capacity (with divebomb bonus for late-braking maneuvers)
    let brakeDecel = 15.6 * gripFactor * this.brakeSkill;
    if (overtakeDecision.canDivebomb) {
      brakeDecel *= 1.18; // Late braking down the inside
    }

    // Dynamic Corner Curvature (kappa = 1/R) Speed Calculation with Lateral Offset Compensation
    const prevPt = this.waypoints[(targetIdx - 1 + numPts) % numPts];
    const curPt = targetPt;
    const fwdPt = nextPt;
    const d12 = Math.hypot(curPt.x - prevPt.x, curPt.z - prevPt.z) || 1;
    const d23 = Math.hypot(fwdPt.x - curPt.x, fwdPt.z - curPt.z) || 1;
    const d13 = Math.hypot(fwdPt.x - prevPt.x, fwdPt.z - prevPt.z) || 1;
    const crossArea = Math.abs((curPt.x - prevPt.x) * (fwdPt.z - prevPt.z) - (curPt.z - prevPt.z) * (fwdPt.x - prevPt.x));
    const curvatureK = (2.0 * crossArea) / (d12 * d23 * d13);
    // Offset curvature compensation: inside tightens turn, outside widens turn
    const offsetCurv = Math.max(0.003, curvatureK * (1.0 - this.lateralOffset * 0.08));
    const maxAeroCornerSpeedMs = Math.sqrt((gripFactor * 9.81 * 1.85) / offsetCurv);
    const geometricCornerSpeedKmh = THREE.MathUtils.clamp(maxAeroCornerSpeedMs * 3.6, 65, 340);

    const baseWaypointLimit = Math.min(targetPt.speedLimitKmh, geometricCornerSpeedKmh);
    let minAllowedSpeedMs = (baseWaypointLimit / 3.6) * diffSpeedScale * gripFactor * engineHealthFactor * slipstreamBonus * emergencyHealthFactor;

    // Scan ahead up to 190 meters along track for future corner speed limits
    let scanDist = 0;
    let scanIdx = targetIdx;
    for (let s = 1; s <= 26; s++) {
      const nextScanIdx = (scanIdx + 1) % numPts;
      const sp1 = this.waypoints[scanIdx];
      const sp2 = this.waypoints[nextScanIdx];
      const stepLen = Math.hypot(sp2.x - sp1.x, sp2.z - sp1.z);
      scanDist += stepLen;
      scanIdx = nextScanIdx;

      if (scanDist > 190.0) break;

      const futureTargetMs = (sp2.speedLimitKmh / 3.6) * diffSpeedScale * gripFactor * engineHealthFactor * emergencyHealthFactor;
      // Kinematic formula: v_allowed = sqrt(v_future^2 + 2 * a * distance)
      const allowedSpeedMs = Math.sqrt(futureTargetMs * futureTargetMs + 2.0 * brakeDecel * scanDist);
      if (allowedSpeedMs < minAllowedSpeedMs) {
        minAllowedSpeedMs = allowedSpeedMs;
      }
    }

    const targetSpeedMs = minAllowedSpeedMs;

    let throttleInput = 0;
    let brakeInput = 0;

    // Longitudinal Speed Control
    if (mySpeed > targetSpeedMs) {
      const excessSpeed = mySpeed - targetSpeedMs;
      throttleInput = 0.0;
      brakeInput = THREE.MathUtils.clamp(excessSpeed / 2.2, 0.45, 1.0);
    } else {
      const deficit = targetSpeedMs - mySpeed;
      throttleInput = THREE.MathUtils.clamp(deficit / 2.4, 0.50, 1.0);
      brakeInput = 0.0;
    }

    // 8. Overtaking & TTLC-based Collision Avoidance (Zero panic braking)
    if (overtakeDecision.isSideBySide) {
      // Parallel battle: FULL THROTTLE to execute the pass!
      throttleInput = 1.0;
      brakeInput = 0.0;
    } else if (overtakeDecision.canSwitchback) {
      // Switchback: Full acceleration on corner exit cut
      throttleInput = 1.0;
      brakeInput = 0.0;
    } else if (radar.center.hit && radar.center.distance < 20.0) {
      const closingSpeed = radar.center.relativeSpeed;
      const ttlc = overtakeDecision.ttlcSeconds;

      if (ttlc < 0.65 || radar.center.distance < 4.8) {
        // Critical collision risk: progressive emergency modulation
        throttleInput = 0.0;
        const packBrake = THREE.MathUtils.clamp((closingSpeed + 2.0) / 3.8, 0.50, 1.0);
        brakeInput = Math.max(brakeInput, packBrake);
      } else if (closingSpeed > 0.4) {
        // Closing in smoothly in the tow: maintain slipstream without slamming brakes
        throttleInput = THREE.MathUtils.clamp(1.0 - (closingSpeed / 6.0), 0.60, 0.98);
      }
    }

    // 9. Authentic Formula 1 G-G Trail Braking:
    // Heavy straight-line braking, bleed off hydraulic pressure as steering angle increases towards apex
    if (brakeInput > 0.05) {
      const steerLockRatio = THREE.MathUtils.clamp(Math.abs(steeringInput), 0, 1);
      const trailMultiplier = 1.0 - (0.50 * this.trailBrakeAbility * steerLockRatio);
      brakeInput *= THREE.MathUtils.clamp(trailMultiplier, 0.35, 1.0);
    }

    if (this.isFinished) {
      throttleInput = 0;
      brakeInput = 0.6;
    }

    // 10. Stuck / Collision Detection & Autonomous Recovery Trigger
    if (isRaceActive && !isControlsLocked && !this.isInPitLane) {
      if (this.speedKmh < 4.0 && throttleInput > 0.35) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 1.0) {
          this.recoveryPhase = 'reverse';
          this.recoveryTimer = 1.5;
        }
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2.5);
      }
    }

    // 11. Step Real Physics Engine for this AI Car
    const inputs: CarInputs = {
      throttle: throttleInput,
      brake: brakeInput,
      steering: steeringInput,
      handbrake: false,
    };
    this.physics.update(dt, inputs);

    // Synchronize coordinates
    this.position.set(this.physics.position.x, this.physics.position.y, this.physics.position.z);
    this.carModel.group.position.copy(this.position);
    this.carModel.group.rotation.set(0, this.physics.yaw, this.physics.roll);

    // Update 3D car visuals with authentic damage, steer angle, and wheel rotations
    this.carModel.update(
      this.physics.visualSteerAngle,
      this.physics.wheelRotations,
      brakeInput,
      mySpeedKmh,
      this.physics.damage,
      this.physics.isShifting,
      this.physics.rpm
    );

    // 12. Distance Along Track & Lap Timing
    if (this.activeCircuit?.checkSectorProgress) {
      const res = this.activeCircuit.checkSectorProgress(myX, myZ, this.currentSector);
      if (res.lapCompleted) {
        this.lastLapTime = this.currentLapTime;
        if (!this.bestLapTime || this.currentLapTime < this.bestLapTime) {
          this.bestLapTime = this.currentLapTime;
        }
        this.currentLap++;
        this.currentLapTime = 0;
        this.currentSector = 0;
      } else {
        this.currentSector = res.newSector;
      }
    } else {
      if (this.currentSector === 0 && myX > 40 && myZ < -50) this.currentSector = 1;
      else if (this.currentSector === 1 && myX > 50 && myZ > 40) this.currentSector = 2;
      else if (this.currentSector === 2 && myX < -40 && myZ > 50) this.currentSector = 3;
      else if (this.currentSector === 3 && myX < -50 && myZ < -40) this.currentSector = 4;
      else if (this.currentSector === 4 && myZ < -115 && myX >= -20 && myX <= 20) {
        this.lastLapTime = this.currentLapTime;
        if (!this.bestLapTime || this.currentLapTime < this.bestLapTime) {
          this.bestLapTime = this.currentLapTime;
        }
        this.currentLap++;
        this.currentLapTime = 0;
        this.currentSector = 0;
      }
    }

    this.currentLapTime += dt;
    this.totalRaceTime += dt;

    this.distanceAlongTrack = (closestIdx / numPts) * this.totalTrackLength;
    this.trackProgressNormalized = this.distanceAlongTrack / this.totalTrackLength;
  }

  /**
   * Dedicated Pit Lane Trajectory & Complete Emergency Mechanical Pit Stop Service
   * Moves along Fast Lane at Z = -119.0, peels off into team's dedicated pit box at Z = -110.5,
   * repairs 100% of damage, replaces tires, and launches back into the race.
   */
  private updatePitLane(dt: number, particles: ParticleSystem): void {
    const stallX = this.team.pitStallX;
    const fastLaneZ = -119.0;
    const pitBoxZ = -110.5;
    const pitSpeedMs = 60.0 / 3.6; // 60 km/h pit limiter
    const peelOffStartX = stallX - 12.0;

    if (!this.isStationaryInBox) {
      if (!this.hasServicedInBox) {
        // Phase 1: Fast Lane Cruise and Smooth S-Curve Peel-off
        this.physics.speed = pitSpeedMs;
        this.physics.position.x += this.physics.speed * dt;

        if (this.physics.position.x < peelOffStartX) {
          this.physics.position.z = THREE.MathUtils.damp(this.physics.position.z, fastLaneZ, 5.0, dt);
          const targetYaw = getNearestAngle(this.physics.yaw, Math.PI / 2);
          this.physics.yaw += (targetYaw - this.physics.yaw) * Math.min(1.0, 6.0 * dt);
        } else {
          const progress = Math.max(0, Math.min(1.0, (this.physics.position.x - peelOffStartX) / 12.0));
          const smoothS = progress * progress * (3 - 2 * progress);
          this.physics.position.z = THREE.MathUtils.lerp(fastLaneZ, pitBoxZ, smoothS);

          const steerOffset = Math.sin(progress * Math.PI) * 0.20;
          const targetYaw = getNearestAngle(this.physics.yaw, (Math.PI / 2) - steerOffset);
          this.physics.yaw += (targetYaw - this.physics.yaw) * Math.min(1.0, 7.0 * dt);
        }

        // Arrived at team's specific pit box
        if (Math.abs(this.physics.position.x - stallX) < 1.2) {
          this.physics.position.x = stallX;
          this.physics.position.z = pitBoxZ;
          this.physics.yaw = getNearestAngle(this.physics.yaw, Math.PI / 2);
          this.physics.speed = 0;
          this.isStationaryInBox = true;
          this.pitTimer = 0;
        }
      } else {
        // Phase 2: Post-service launch and S-curve merge back into Fast Lane
        this.physics.speed = pitSpeedMs;
        this.physics.position.x += this.physics.speed * dt;

        const mergeEndX = stallX + 12.0;
        if (this.physics.position.x < mergeEndX) {
          const exitProg = Math.max(0, Math.min(1.0, (this.physics.position.x - stallX) / 12.0));
          const smoothExit = exitProg * exitProg * (3 - 2 * exitProg);
          this.physics.position.z = THREE.MathUtils.lerp(pitBoxZ, fastLaneZ, smoothExit);

          const steerExitYaw = getNearestAngle(this.physics.yaw, (Math.PI / 2) + Math.sin(exitProg * Math.PI) * 0.16);
          this.physics.yaw += (steerExitYaw - this.physics.yaw) * Math.min(1.0, 7.0 * dt);
        } else {
          this.physics.position.z = THREE.MathUtils.damp(this.physics.position.z, fastLaneZ, 5.0, dt);
          const targetYaw = getNearestAngle(this.physics.yaw, Math.PI / 2);
          this.physics.yaw += (targetYaw - this.physics.yaw) * Math.min(1.0, 6.0 * dt);
        }

        // Pit exit transition back onto the main straight
        if (this.physics.position.x > 38.0) {
          this.physics.position.z += (-125.0 - this.physics.position.z) * Math.min(1.0, 3.5 * dt);
        }

        if (this.physics.position.x >= 46.0) {
          // Rejoin main track smoothly at racing speed
          this.isInPitLane = false;
          this.hasServicedInBox = false;
          this.physics.speed = 100.0 / 3.6;
          particles.emitTireSmoke(this.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 10, 0.95);
        }
      }
    } else {
      // Stationary in box getting serviced by pit crew
      this.physics.speed = 0;
      this.physics.position.x = stallX;
      this.physics.position.z = pitBoxZ;
      this.physics.yaw = getNearestAngle(this.physics.yaw, Math.PI / 2);
      this.pitTimer += dt;
      this.pitProgress = Math.min(1.0, this.pitTimer / this.pitDuration);

      // Midway through stop: Full vehicle repair (bodywork, wings, engine, suspension, tires)
      if (this.pitTimer >= this.pitDuration * 0.5 && !this.hasServicedInBox) {
        if (this.currentCompound !== this.nextPitCompound) {
          this.currentCompound = this.nextPitCompound;
        } else {
          this.currentCompound = this.currentCompound === 'soft' ? 'medium' : 'soft';
        }
        this.compoundsUsed.add(this.currentCompound);
        this.carModel.setTireCompoundVisuals(this.currentCompound);
        this.physics.setTireCompound(this.currentCompound);
        this.physics.repairFull();
        this.isInEmergencyPitLap = false;
      }

      if (this.pitTimer >= this.pitDuration) {
        this.isStationaryInBox = false;
        this.hasServicedInBox = true;
        this.pitStopsCount++;
      }
    }

    this.position.set(this.physics.position.x, this.physics.position.y, this.physics.position.z);
    this.carModel.group.position.copy(this.position);
    this.carModel.group.rotation.set(0, this.physics.yaw, this.physics.roll);
  }

  /**
   * Exports live data for F1 leaderboard
   */
  public getLeaderboardData(position: number, leaderScore: number): DriverLeaderboardEntry {
    const avgWear = (this.physics.tireWear[0] + this.physics.tireWear[1] + this.physics.tireWear[2] + this.physics.tireWear[3]) / 4;
    const myScore = (this.currentLap - 1) * this.totalTrackLength + this.distanceAlongTrack;
    const scoreDelta = Math.max(0, leaderScore - myScore);
    const gapSeconds = scoreDelta / CIRCUIT_RACE_PACE_SPEED;
    const lapsBehind = Math.floor(scoreDelta / this.totalTrackLength);

    const gapFormatted = position === 1 ? 'LÍDER' : lapsBehind >= 1 ? `+${lapsBehind} ${lapsBehind === 1 ? 'VTA' : 'VTAS'}` : formatF1TimeGap(gapSeconds);

    return {
      id: this.team.id,
      position,
      driverCode: this.team.driverCode,
      driverName: this.team.driverName,
      driverNumber: this.team.driverNumber,
      teamName: this.team.teamName,
      teamColorCss: this.team.teamColorCss,
      currentLap: this.currentLap,
      currentSector: this.currentSector,
      currentCompound: this.currentCompound,
      compoundsUsed: Array.from(this.compoundsUsed),
      hasSatisfiedTireRule: this.compoundsUsed.size >= 2,
      tireWearAvg: avgWear,
      pitStopsCount: this.pitStopsCount,
      isInPit: this.isInPitLane,
      gapToLeaderFormatted: gapFormatted,
      gapToAheadFormatted: position === 1 ? '-' : formatF1TimeGap(gapSeconds * 0.5),
      lastLapTime: this.lastLapTime,
      bestLapTime: this.bestLapTime,
      currentLapTime: this.currentLapTime,
      totalRaceTime: this.totalRaceTime,
      isPlayer: false,
      isFinished: this.isFinished,
      hasPenalty: false,
      penaltySeconds: 0,
    };
  }
}
