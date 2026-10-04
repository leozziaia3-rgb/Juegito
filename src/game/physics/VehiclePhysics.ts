/**
 * VehiclePhysics.ts - High-Grip Circuit Racing Physics Engine
 * Designed for authentic high-downforce GT/LeMans Prototype racing:
 * - High-speed on-rails cornering with ZERO unwanted drifting or sliding
 * - Agile, fast turn-in through 90° corners
 * - Rock-solid straight-line tracking with instant caster self-centering
 * - Controlled power slides ONLY when holding the Handbrake button
 * - Comprehensive damage degradation and pit stop repair system
 */

import * as THREE from 'three';
import { TireCompoundType, TIRE_COMPOUNDS } from './TireCompound';

export interface CarInputs {
  throttle: number;   // 0.0 to 1.0
  brake: number;      // 0.0 to 1.0
  steering: number;   // -1.0 (left) to 1.0 (right)
  handbrake: boolean; // boolean
  drs?: boolean;      // F1 Drag Reduction System (Active Aero Flap Open)
}

export interface DamageState {
  overallHealth: number;    // 0 to 100
  engineHealth: number;     // 0 to 100
  suspensionLeft: number;   // 0 to 100
  suspensionRight: number;  // 0 to 100
  frontCrumple: number;     // 0.0 to 1.0 (nosecone smash)
  rearCrumple: number;      // 0.0 to 1.0
  frontWingLeftDamage: number;  // 0.0 to 1.0 (droop, scrape, bend)
  frontWingRightDamage: number; // 0.0 to 1.0
  frontWingLeftUpperFlapDetached: boolean;  // Cascade upper flaps 3 & 4 torn away
  frontWingRightUpperFlapDetached: boolean;
  frontWingLeftDetached: boolean;  // Entire left mainplane assembly torn off
  frontWingRightDetached: boolean; // Entire right mainplane assembly torn off
  endplateLeftDetached: boolean;
  endplateRightDetached: boolean;
  rearWingLeftDetached: boolean;   // Rear left endplate & swan-neck severed
  rearWingRightDetached: boolean;  // Rear right endplate & swan-neck severed
  drsFlapBroken: boolean;          // Upper DRS flap torn or stuck crooked
  wingLoose: boolean;
  wingDamageAmount: number;
  isTotaled: boolean;
  suspensionCamberFL: number;
  suspensionCamberFR: number;
  suspensionCamberRL: number;
  suspensionCamberRR: number;
}

export class VehiclePhysics {
  // World transforms
  public position = { x: 0, y: 0.35, z: 0 };
  public yaw: number = 0;              // Heading angle in radians
  public pitch: number = 0;            // Weight transfer pitch (dive / squat)
  public roll: number = 0;             // Cornering roll angle

  // Sub-frame temporal interpolation states (for rock-solid 60-144 FPS smoothness)
  public prevPosition = { x: 0, y: 0.35, z: 0 };
  public prevYaw: number = 0;
  public prevPitch: number = 0;
  public prevRoll: number = 0;
  private smoothedLongAccel: number = 0;

  // Velocities
  public speed: number = 0;            // m/s (positive = forward, negative = reverse)
  public lateralSpeed: number = 0;     // m/s
  public angularVelocity: number = 0;  // rad/s

  // Steering
  public steerAngle: number = 0;       // Current wheel steer angle in radians
  private targetSteerAngle: number = 0;

  // Engine & Transmission
  public rpm: number = 1000;
  public engineTemp: number = 85.0;    // Engine core temperature in °C (85°C to 135°C)
  public gear: number = 1;             // -1 = R, 0 = N, 1..6 = D
  public isShifting: boolean = false;
  private shiftTimer: number = 0;

  // Gear ratios & parameters (Calibrated for 0-100 km/h in 1.5s and 350 km/h top speed)
  private readonly gearRatios = [3.25, 2.25, 1.68, 1.32, 1.08, 0.90];
  private readonly reverseRatio = 2.80;
  private readonly finalDrive = 3.10;
  private readonly maxRpm = 9500;
  private readonly idleRpm = 1000;

  // Physical specifications (High-downforce prototype racing chassis)
  public readonly mass = 1180;         // kg
  public readonly wheelbase = 2.75;     // meters
  public readonly trackWidth = 1.95;    // meters
  private readonly dragCoeff = 0.28;   // Aerodynamic low-drag package calibrated for 350 km/h
  private readonly downforceCoeff = 3.8; // High-downforce ground-effect aerodynamic package

  // Telemetry & Grip (Pacejka Non-Linear Slip Dynamics)
  public slipRatio: number = 0;
  public isDrifting: boolean = false;
  public wheelRotations = [0, 0, 0, 0];
  public visualSteerAngle: number = 0;
  public slipAngleRear: number = 0;
  public slipAngleFront: number = 0;
  public wheelSlipRatios = [0, 0, 0, 0]; // [FL, FR, RL, RR]
  public wheelSuspensionCompression = [0, 0, 0, 0]; // [FL, FR, RL, RR]
  public lateralG: number = 0;

  // --- F1 TIRE COMPOUND, WEAR DEGRADATION & PUNCTURE SYSTEM ---
  public tireCompound: TireCompoundType = 'soft';
  public tireWear: [number, number, number, number] = [0, 0, 0, 0]; // 0% (pristine) to 100% (blown/bald) [FL, FR, RL, RR]
  public isPunctured: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  public tireTemps: [number, number, number, number] = [95, 95, 95, 95]; // °C
  public punctureWobble: number = 0;

  // --- F1 DRS (DRAG REDUCTION SYSTEM) & MGU-K HYBRID BOOST ---
  public isDrsOpen: boolean = false;
  public isDrsAvailable: boolean = false;

  public get hasAnyPuncture(): boolean {
    return this.isPunctured[0] || this.isPunctured[1] || this.isPunctured[2] || this.isPunctured[3];
  }

  // Damage System
  public damage: DamageState = {
    overallHealth: 100,
    engineHealth: 100,
    suspensionLeft: 100,
    suspensionRight: 100,
    frontCrumple: 0,
    rearCrumple: 0,
    frontWingLeftDamage: 0,
    frontWingRightDamage: 0,
    frontWingLeftUpperFlapDetached: false,
    frontWingRightUpperFlapDetached: false,
    frontWingLeftDetached: false,
    frontWingRightDetached: false,
    endplateLeftDetached: false,
    endplateRightDetached: false,
    rearWingLeftDetached: false,
    rearWingRightDetached: false,
    drsFlapBroken: false,
    wingLoose: false,
    wingDamageAmount: 0,
    isTotaled: false,
    suspensionCamberFL: 0,
    suspensionCamberFR: 0,
    suspensionCamberRL: 0,
    suspensionCamberRR: 0,
  };

  // Pit Stop Repair State
  public isInPitStop: boolean = false;
  public pitRepairProgress: number = 0;
  public isLockedInPit: boolean = false;

  // Sound triggers
  public onBackfire?: (isHighRpm: boolean) => void;
  public onCrash?: (impactForce: number) => void;
  public onPitFinish?: () => void;
  public onTireBlowout?: (wheelIdx: number) => void;

  constructor(startX: number = 0, startZ: number = 0, startYaw: number = 0) {
    this.reset(startX, startZ, startYaw);
  }

  public reset(x: number = 0, z: number = 0, yaw: number = 0): void {
    this.position.x = x;
    this.position.y = 0.35;
    this.position.z = z;
    this.yaw = yaw;
    this.prevPosition.x = x;
    this.prevPosition.y = 0.35;
    this.prevPosition.z = z;
    this.prevYaw = yaw;
    this.prevPitch = 0;
    this.prevRoll = 0;
    this.smoothedLongAccel = 0;
    this.speed = 0;
    this.lateralSpeed = 0;
    this.angularVelocity = 0;
    this.steerAngle = 0;
    this.targetSteerAngle = 0;
    this.pitch = 0;
    this.roll = 0;
    this.gear = 1;
    this.rpm = 1000;
    this.wheelRotations = [0, 0, 0, 0];
    this.punctureWobble = 0;
    this.repairFull();
  }

  public setTireCompound(compound: TireCompoundType): void {
    this.tireCompound = compound;
    this.repairTires();
  }

  public repairTires(): void {
    this.tireWear = [0, 0, 0, 0];
    this.isPunctured = [false, false, false, false];
    const optTemp = TIRE_COMPOUNDS[this.tireCompound]?.optimalTemp || 95;
    this.tireTemps = [optTemp, optTemp, optTemp, optTemp];
    this.punctureWobble = 0;
  }

  public repairFull(): void {
    this.damage.overallHealth = 100;
    this.damage.engineHealth = 100;
    this.damage.suspensionLeft = 100;
    this.damage.suspensionRight = 100;
    this.damage.frontCrumple = 0;
    this.damage.rearCrumple = 0;
    this.damage.frontWingLeftDamage = 0;
    this.damage.frontWingRightDamage = 0;
    this.damage.frontWingLeftUpperFlapDetached = false;
    this.damage.frontWingRightUpperFlapDetached = false;
    this.damage.frontWingLeftDetached = false;
    this.damage.frontWingRightDetached = false;
    this.damage.endplateLeftDetached = false;
    this.damage.endplateRightDetached = false;
    this.damage.rearWingLeftDetached = false;
    this.damage.rearWingRightDetached = false;
    this.damage.drsFlapBroken = false;
    this.damage.wingLoose = false;
    this.damage.wingDamageAmount = 0;
    this.damage.isTotaled = false;
    this.damage.suspensionCamberFL = 0;
    this.damage.suspensionCamberFR = 0;
    this.damage.suspensionCamberRL = 0;
    this.damage.suspensionCamberRR = 0;
    this.pitRepairProgress = 0;
    this.repairTires();
  }

  /**
   * Main High-Grip Physics Simulation Tick
   */
  public update(dt: number, inputs: CarInputs): void {
    const clampedDt = Math.min(dt, 0.05);

    // Save previous snapshot for silky-smooth sub-frame temporal render interpolation
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.prevRoll = this.roll;

    if (this.isLockedInPit) {
      this.speed = 0;
      this.lateralSpeed = 0;
      this.angularVelocity = 0;
      this.rpm = 1000 + Math.sin(Date.now() * 0.006) * 120;
      this.gear = 1;
      return;
    }

    this.updatePitRepair(clampedDt);

    const compoundConfig = TIRE_COMPOUNDS[this.tireCompound] || TIRE_COMPOUNDS.soft;
    const enginePowerFactor = Math.max(0.25, this.damage.engineHealth / 100);
    const speedKmh = Math.abs(this.speed) * 3.6;
    const hasPuncture = this.hasAnyPuncture;

    // --- 0. DYNAMIC 4-WHEEL TIRE WEAR & BLOWOUT SYSTEM ---
    const wearMultiplier = compoundConfig.wearRateMultiplier;
    const absSpeed = Math.abs(this.speed);
    
    // Balanced base rolling wear per wheel (Soft lasts ~3-4 laps, Med ~7-9 laps, Hard ~15+ laps)
    const baseWearDelta = (absSpeed * 0.00018) * wearMultiplier * clampedDt;

    for (let i = 0; i < 4; i++) {
      if (this.isPunctured[i]) {
        this.tireWear[i] = 100;
        continue;
      }

      // Dynamic wear based on slip ratio, lateral load, braking lockup, and wheelspin
      const wheelSlip = this.wheelSlipRatios[i] || 0;
      const slipWear = (wheelSlip * 0.25) * wearMultiplier * clampedDt;
      const gWear = (Math.pow(Math.abs(this.lateralG), 2.0) * 0.025) * wearMultiplier * clampedDt;

      // Front tires suffer extra flat-spotting under hard threshold braking
      const brakeLockWear = (i < 2 && inputs.brake > 0.85 && speedKmh > 80) ? (inputs.brake * 0.18 * wearMultiplier * clampedDt) : 0;
      // Rear tires suffer extra burnout wear under launch wheelspin
      const launchBurnoutWear = (i >= 2 && inputs.throttle > 0.90 && speedKmh < 20 && this.gear === 1) ? (0.28 * wearMultiplier * clampedDt) : 0;

      this.tireWear[i] = Math.min(100, this.tireWear[i] + baseWearDelta + slipWear + gWear + brakeLockWear + launchBurnoutWear);

      // Temperature dynamics per wheel
      const targetTireTemp = compoundConfig.optimalTemp + (wheelSlip * 20.0) + (Math.abs(this.lateralG) * 8.0) - (speedKmh * 0.03);
      this.tireTemps[i] += (targetTireTemp - this.tireTemps[i]) * (1.0 - Math.exp(-0.85 * clampedDt));

      // 100% WEAR = TIRE BLOWOUT / REVENTÓN (PINCHAZO)!
      if (this.tireWear[i] >= 100 && !this.isPunctured[i]) {
        this.isPunctured[i] = true;
        if (this.onTireBlowout) {
          this.onTireBlowout(i);
        }
      }
    }

    // --- 0.1. TIRE GRIP FACTOR (Pacejka compound curve + Wear degradation) ---
    // [FL, FR, RL, RR]
    const tireGrip = [1.0, 1.0, 1.0, 1.0];
    for (let i = 0; i < 4; i++) {
      if (this.isPunctured[i]) {
        // Blown tire has virtually zero grip (0.12 - metal rim scraping on road)
        tireGrip[i] = 0.12;
      } else {
        const wear = this.tireWear[i];
        if (wear < 75) {
          // Gentle linear wear decay (1.0 down to 0.82)
          tireGrip[i] = 1.0 - (wear / 75) * 0.18;
        } else {
          // Steep cliff past 75% wear (0.82 down to 0.45 at 99% bald)
          const cliff = (wear - 75) / 25;
          tireGrip[i] = 0.82 - cliff * 0.37;
        }
      }
    }

    const avgFrontGrip = ((tireGrip[0] + tireGrip[1]) / 2) * compoundConfig.gripMultiplier;
    const avgRearGrip = ((tireGrip[2] + tireGrip[3]) / 2) * compoundConfig.gripMultiplier;
    const overallGrip = ((avgFrontGrip + avgRearGrip) / 2);

    // --- 0.2. F1 DRS ACTIVATION LOGIC & SAFETY CUTOFF ---
    // DRS is available whenever the car is moving forward (> 10 km/h) without blown tires.
    this.isDrsAvailable = (speedKmh > 10.0 && !hasPuncture);

    // ONLY the brake pedal or manual toggle closes DRS. Steering, turning, or cornering NEVER closes DRS!
    if (inputs.brake > 0.15) {
      this.isDrsOpen = false;
      inputs.drs = false;
    } else if (inputs.drs) {
      // Once clicked/activated, it stays locked ON through straightaways and corners until braking or manual toggle
      this.isDrsOpen = true;
    } else {
      this.isDrsOpen = false;
    }

    // --- 1. PRECISE STEERING WITH RACING SPEED-SENSITIVE RACK RATIO ---
    const speedNorm = Math.min(1.0, speedKmh / 280);
    // Parking lock 0.52 rad (~30 deg) tapers gracefully to 0.145 rad (~8.3 deg) at 280+ km/h
    let maxLock = THREE.MathUtils.lerp(0.52, 0.145, Math.pow(speedNorm, 0.65));
    
    // Blown front tire impairs steering agility
    if (this.isPunctured[0] || this.isPunctured[1]) {
      maxLock *= 0.65;
    }

    const suspensionDiff = (this.damage.suspensionLeft - this.damage.suspensionRight);
    const suspensionBias = Math.abs(suspensionDiff) > 8 ? suspensionDiff * 0.0008 : 0;

    // Asymmetrical steering pull caused by flat tire drag (Left puncture pulls left, Right pulls right)
    let punctureSteerPull = 0;
    if (hasPuncture && speedKmh > 2.0) {
      const leftPunctures = (this.isPunctured[0] ? 1 : 0) + (this.isPunctured[2] ? 0.7 : 0);
      const rightPunctures = (this.isPunctured[1] ? 1 : 0) + (this.isPunctured[3] ? 0.7 : 0);
      punctureSteerPull = (leftPunctures - rightPunctures) * 0.085 * Math.min(1.0, speedKmh / 25.0);
    }

    if (Math.abs(inputs.steering) > 0.02) {
      this.targetSteerAngle = (inputs.steering * maxLock) - suspensionBias + punctureSteerPull;
      const steerSpeed = (this.isPunctured[0] || this.isPunctured[1]) ? 14.0 : 24.0;
      this.steerAngle += (this.targetSteerAngle - this.steerAngle) * Math.min(1.0, steerSpeed * clampedDt);
    } else {
      // Immediate elastic snap back to center with puncture pull bias
      const casterReturnSpeed = 32.0;
      const neutralAngle = punctureSteerPull;
      this.steerAngle += (neutralAngle - this.steerAngle) * Math.min(1.0, casterReturnSpeed * clampedDt);
      if (Math.abs(this.steerAngle) < 0.001 && !hasPuncture) this.steerAngle = 0;
    }

    // --- 2. TRANSMISSION & ENGINE RPM WITH PROGRESSIVE CLUTCH DYNAMICS ---
    this.updateTransmission(clampedDt, inputs.throttle, enginePowerFactor);

    // --- 3. LONGITUDINAL DRIVE & BRAKING (EXTREME HYPERCAR ACCELERATION OR LIMP MODE) ---
    let drivingForce = 0;
    let brakeForce = 0;
    const currentRatio = this.gear === -1 ? this.reverseRatio : (this.gearRatios[this.gear - 1] || 1.0);
    const totalGearRatio = currentRatio * this.finalDrive;

    // Smooth C1-continuous shift torque taper (eliminates discrete jerk/rubber-banding during gear changes)
    let shiftTorqueFactor = 1.0;
    if (this.shiftTimer > 0) {
      const phase = Math.max(0, Math.min(1.0, this.shiftTimer / 0.055));
      const dip = Math.sin(phase * Math.PI) * 0.28;
      shiftTorqueFactor = 1.0 - dip;
    }

    // Handbrake applied deceleration drag
    const handbrakeDrag = (inputs.handbrake && this.speed > 0.5) ? -13500 : 0;

    // Limp mode power reduction when punctured
    const limpPowerFactor = hasPuncture ? 0.28 : 1.0;

    if (this.gear === -1) {
      // IN REVERSE GEAR:
      if (inputs.brake > 0.05) {
        const reverseEfficiency = 11500 * enginePowerFactor * limpPowerFactor * inputs.brake * shiftTorqueFactor;
        drivingForce = -reverseEfficiency;
        if (this.speed < -18.0) {
          drivingForce = 0;
        }
      }

      if (inputs.throttle > 0.05) {
        if (this.speed < -0.3) {
          brakeForce = inputs.throttle * 18000;
        } else {
          this.gear = 1;
          const normalizedRpm = Math.max(0, (this.rpm - this.idleRpm) / (this.maxRpm - this.idleRpm));
          const torqueEfficiency = Math.sin(normalizedRpm * Math.PI * 0.82 + 0.18) * 0.30 + 0.70;
          const baseEngineForce = 31500 * enginePowerFactor * limpPowerFactor * inputs.throttle * torqueEfficiency;
          drivingForce = (baseEngineForce * totalGearRatio) / 8.6;
        }
      }
    } else {
      // IN FORWARD GEARS (1..6):
      if (inputs.throttle > 0 && !inputs.handbrake) {
        const normalizedRpm = Math.max(0, (this.rpm - this.idleRpm) / (this.maxRpm - this.idleRpm));
        const torqueEfficiency = Math.sin(normalizedRpm * Math.PI * 0.82 + 0.18) * 0.28 + 0.72;

        // DRS Boost: When DRS is open, electric MGU-K deploys extra 32% acceleration torque and top speed increases
        const drsBoostFactor = this.isDrsOpen ? 1.32 : 1.0;
        const topSpeedThreshold = this.isDrsOpen ? 362.0 : 325.0;
        const topSpeedSpan = this.isDrsOpen ? 24.0 : 27.0;

        // Smooth C1-continuous asymptotic top speed governor (eliminates hunting/jerking at high speeds)
        let topSpeedGovernor = 1.0;
        if (hasPuncture) {
          // PUNCTURE LIMP MODE: Speed strictly limited to 38-40 km/h
          topSpeedGovernor = speedKmh > 36.0
            ? Math.max(0, 1.0 - Math.min(1.0, (speedKmh - 36.0) / 4.0))
            : 1.0;
        } else if (speedKmh > topSpeedThreshold) {
          // Smooth Hermite smoothstep taper allowing up to 386 km/h with DRS open!
          const t = Math.min(1.0, Math.max(0.0, (speedKmh - topSpeedThreshold) / topSpeedSpan));
          const smoothFactor = 3.0 * t * t - 2.0 * t * t * t;
          topSpeedGovernor = 1.0 - smoothFactor * 0.94;
        }

        const baseEngineForce = 31500 * enginePowerFactor * limpPowerFactor * inputs.throttle * torqueEfficiency * shiftTorqueFactor * topSpeedGovernor * drsBoostFactor;
        drivingForce = (baseEngineForce * totalGearRatio) / 8.6;
      } else if (inputs.throttle > 0 && inputs.handbrake) {
        drivingForce = 0;
      }

      if (inputs.brake > 0.05) {
        if (this.speed > 0.35) {
          const aeroBrakeBoost = 1.0 + Math.min(0.6, speedKmh / 250);
          brakeForce = -inputs.brake * 26500 * aeroBrakeBoost * Math.max(0.4, overallGrip);
        } else {
          this.speed = 0;
          this.lateralSpeed = 0;
          // Only engage reverse if holding brake without throttle and without handbrake
          if (!inputs.handbrake && inputs.throttle === 0) {
            this.gear = -1;
            drivingForce = -inputs.brake * 8500 * enginePowerFactor * limpPowerFactor;
          } else {
            this.gear = 1;
            drivingForce = 0;
            brakeForce = 0;
          }
        }
      }
    }

    // Aerodynamics & Continuous Rolling Resistance (DRS cuts aerodynamic drag by 52%!)
    const effectiveDrag = this.isDrsOpen ? (this.dragCoeff * 0.48) : this.dragCoeff;
    const airResistance = 0.5 * 1.225 * effectiveDrag * 2.05 * Math.sign(this.speed) * (this.speed * this.speed);
    
    // Count punctured tires to add rim-on-asphalt friction
    const puncturedCount = (this.isPunctured[0] ? 1 : 0) + (this.isPunctured[1] ? 1 : 0) + (this.isPunctured[2] ? 1 : 0) + (this.isPunctured[3] ? 1 : 0);
    const punctureRollingDrag = puncturedCount * 2800 * Math.tanh(this.speed / 0.4);

    const rollingResistance = (0.010 * this.mass * 9.81 * Math.tanh(this.speed / 0.4)) + punctureRollingDrag;

    // Hard Limp Mode Brake drag if over 40 km/h while punctured
    const limpOverspeedBrake = (hasPuncture && speedKmh > 40.0) ? (-Math.sign(this.speed) * 16500) : 0;

    const netLongForce = drivingForce + brakeForce + handbrakeDrag + limpOverspeedBrake - airResistance - rollingResistance;
    const longAccel = netLongForce / this.mass;
    this.speed += longAccel * clampedDt;

    // Firm clamp when handbrake is engaged at low speed (guarantees rock-solid grid clamping)
    if (inputs.handbrake && Math.abs(this.speed) < 1.2) {
      this.speed = 0;
      this.lateralSpeed = 0;
      if (this.gear === -1) {
        this.gear = 1;
      }
    }

    // Natural friction decay when coasting (much faster when punctured!)
    if (inputs.throttle === 0 && inputs.brake === 0 && !inputs.handbrake) {
      const coastDecay = hasPuncture ? 2.8 : 0.65;
      this.speed *= Math.exp(-coastDecay * clampedDt);
      if (Math.abs(this.speed) < 0.02) this.speed = 0;
    }

    // --- 4. FORMULA 1 GROUND-EFFECT AERODYNAMIC DOWNFORCE & RACING CORNERING ---
    // Modern F1 cars generate massive aerodynamic vertical load scaling with v^2
    // Lateral G capacity increases up to 6.2G+ at high speed for blazing cornering speeds!
    const frontAeroLoss = Math.min(0.75,
      ((this.damage.frontWingLeftDamage || 0) + (this.damage.frontWingRightDamage || 0)) * 0.25 +
      (this.damage.frontWingLeftDetached ? 0.35 : 0) +
      (this.damage.frontWingRightDetached ? 0.35 : 0)
    );
    const rearAeroLoss = Math.min(0.85,
      (this.damage.wingDamageAmount || 0) * 0.45 +
      (this.damage.rearWingLeftDetached ? 0.35 : 0) +
      (this.damage.rearWingRightDetached ? 0.35 : 0) +
      (this.damage.drsFlapBroken ? 0.20 : 0)
    );

    const speed100 = speedKmh / 100.0;
    const baseAeroG = 1.45 * Math.pow(speed100, 1.70);
    const effectiveAeroG = baseAeroG * (1.0 - (frontAeroLoss + rearAeroLoss) * 0.5);
    const aeroDownforceFactor = 1.0 + Math.max(0, effectiveAeroG);
    const dynamicPeakG = compoundConfig.maxCorneringG * overallGrip * aeroDownforceFactor;

    // Actual lateral acceleration demanded by trajectory:
    const radius = Math.max(12.0, 2.75 / Math.max(0.015, Math.abs(this.steerAngle)));
    const latDemandG = (this.speed * this.speed) / (radius * 9.81);

    // STRICT REAL DRIFT TRIGGERING CONDITIONS:
    // F1 cars run strictly on rails and DO NOT drift unless explicitly forced:
    // 1. Explicit Handbrake pull
    const isHandbrakeSlide = inputs.handbrake && speedKmh > 12.0 && Math.abs(this.steerAngle) > 0.04;
    // 2. Brutal Power Oversteer in 1st/2nd gear from low speed with 100% throttle
    const isPowerOversteer = (inputs.throttle > 0.95 && speedKmh < 32.0 && this.gear <= 2 && Math.abs(this.steerAngle) > 0.22);
    // 3. Flat / Punctured tire
    const isBlownTireSlide = hasPuncture && speedKmh > 20.0 && Math.abs(this.steerAngle) > 0.12;
    // 4. Extreme terminal overcooked entry (exceeding total mechanical + aerodynamic grip by >45%!)
    const isTerminalOvercooked = (latDemandG > dynamicPeakG * 1.45 && speedKmh > 95.0 && Math.abs(this.steerAngle) > 0.14);

    const driftTriggered = isHandbrakeSlide || isPowerOversteer || isBlownTireSlide || isTerminalOvercooked;

    // Drift only sustains while sliding heavily with significant counter-steering, recovering immediately
    const canSustainDrift = driftTriggered || (this.isDrifting && Math.abs(this.lateralSpeed) > 2.4 && Math.abs(this.steerAngle) > 0.10);

    this.isDrifting = canSustainDrift;

    // --- 5. RACING YAW & PROGRESSIVE DRIFT CONTROL DYNAMICS ---
    if (absSpeed > 0.2) {
      if (this.isDrifting) {
        // Controlled, progressive lateral slide (smooth and never ice-like)
        const kickDir = Math.sign(this.steerAngle);
        if (inputs.handbrake) {
          this.lateralSpeed += kickDir * 18.0 * clampedDt;
        } else if (isTerminalOvercooked) {
          const excessG = Math.min(1.2, latDemandG - dynamicPeakG);
          this.lateralSpeed += kickDir * (excessG * 7.0 + 1.2) * clampedDt;
        } else if (isPowerOversteer) {
          this.lateralSpeed += kickDir * 6.5 * clampedDt;
        } else if (isBlownTireSlide) {
          this.lateralSpeed += kickDir * 9.0 * clampedDt;
        }

        // Safety envelope: clamp lateral speed so it stays controllable and doesn't violently snap
        const maxLatSpeed = Math.min(8.5, Math.max(3.0, absSpeed * 0.40));
        this.lateralSpeed = THREE.MathUtils.clamp(this.lateralSpeed, -maxLatSpeed, maxLatSpeed);

        // Stabilizing oversteer torque and snappy counter-steering recovery
        const oversteerMoment = Math.sign(this.lateralSpeed || 1) * Math.min(1.8, Math.abs(this.lateralSpeed) * 0.26);
        const steerTorque = this.steerAngle * 3.4 * avgFrontGrip;
        const stabilizingDamping = -this.angularVelocity * 1.15;

        const targetYawVel = steerTorque + oversteerMoment + stabilizingDamping;
        const driftYawResponse = 22.0;
        this.angularVelocity += (targetYawVel - this.angularVelocity) * Math.min(1.0, driftYawResponse * clampedDt);

        // Moderate lateral damping while in drift: sustains nicely through apex, straightens cleanly on exit
        this.lateralSpeed *= Math.exp(-9.5 * clampedDt);
        // Scrub excess speed naturally in drift
        this.speed *= Math.exp(-0.35 * clampedDt);

        const driftAngle = Math.atan2(this.lateralSpeed, Math.max(1.0, absSpeed));
        this.visualSteerAngle = THREE.MathUtils.clamp(this.steerAngle - driftAngle * 0.75, -0.65, 0.65);
      } else {
        // Authentic F1 "On-Rails" High-Downforce Cornering with Razor-Sharp Front-End Bite
        const speedFactor = THREE.MathUtils.clamp(1.0 - (speedKmh / 380) * 0.15, 0.85, 1.0);
        const turnPower = 3.65 * avgFrontGrip * speedFactor;
        let targetSteerYaw = this.steerAngle * turnPower * Math.sign(this.speed);

        // Puncture yaw torque pull (Asymmetrical dragging)
        if (hasPuncture && speedKmh > 3.0) {
          const leftPunctures = (this.isPunctured[0] ? 1 : 0) + (this.isPunctured[2] ? 0.6 : 0);
          const rightPunctures = (this.isPunctured[1] ? 1 : 0) + (this.isPunctured[3] ? 0.6 : 0);
          const pullYaw = (leftPunctures - rightPunctures) * 0.65 * Math.min(1.0, speedKmh / 25.0);
          targetSteerYaw += pullYaw;
        }

        const gripYawResponse = 42.0;
        this.angularVelocity += (targetSteerYaw - this.angularVelocity) * Math.min(1.0, gripYawResponse * clampedDt);

        // Solid grip damping: clean tracking on rails
        this.lateralSpeed *= Math.exp(-42.0 * clampedDt);
        if (Math.abs(this.lateralSpeed) < 0.005) this.lateralSpeed = 0;

        this.visualSteerAngle = this.steerAngle;
      }
    } else {
      this.angularVelocity *= (1.0 - 28.0 * clampedDt);
      if (Math.abs(this.angularVelocity) < 0.001) this.angularVelocity = 0;
      this.visualSteerAngle = this.steerAngle;
      this.isDrifting = false;
    }

    this.yaw += this.angularVelocity * clampedDt;

    // --- 6. 4-WHEEL INDEPENDENT SLIP RATIOS & SUSPENSION LOAD TRANSFER ---
    const lateralG = (this.speed * this.angularVelocity) / 9.81;
    this.lateralG = lateralG;

    // Lateral Load Transfer: Outside wheels compress, inside wheels unload
    const loadTransfer = THREE.MathUtils.clamp(lateralG * 0.35, -0.42, 0.42);
    const loadLeft = 0.5 - loadTransfer;
    const loadRight = 0.5 + loadTransfer;

    // Suspension compression delta (meters) + Flat tire compression drop (-0.08m on deflated corners)
    this.wheelSuspensionCompression[0] = (-loadTransfer * 0.028) - (this.isPunctured[0] ? 0.085 : 0); // FL
    this.wheelSuspensionCompression[1] = (loadTransfer * 0.028) - (this.isPunctured[1] ? 0.085 : 0);  // FR
    this.wheelSuspensionCompression[2] = (-loadTransfer * 0.034) - (this.isPunctured[2] ? 0.085 : 0); // RL
    this.wheelSuspensionCompression[3] = (loadTransfer * 0.034) - (this.isPunctured[3] ? 0.085 : 0);  // RR

    // Realistic wheel slip ratios [FL, FR, RL, RR]
    const latSlip = this.isDrifting
      ? Math.min(1.0, (Math.abs(this.lateralSpeed) / Math.max(3.0, absSpeed)) * 1.5)
      : (Math.abs(this.lateralSpeed) > 0.8 ? 0.18 : 0);
    const handbrakeSlip = inputs.handbrake ? 0.95 : 0;
    const brakeSlip = (inputs.brake > 0.85 && speedKmh > 95) ? 0.35 : 0;
    const launchSlip = (inputs.throttle > 0.85 && speedKmh < 20 && this.gear === 1) ? 0.32 : 0;

    for (let i = 0; i < 4; i++) {
      if (this.isPunctured[i]) {
        this.wheelSlipRatios[i] = Math.min(1.0, Math.max(0.65, absSpeed / 12.0));
      } else {
        const isLeft = i % 2 === 0;
        const isRear = i >= 2;
        const load = isLeft ? loadLeft : loadRight;
        const slip = isRear
          ? Math.max(handbrakeSlip, launchSlip, latSlip * (load * 1.5) * (this.isDrifting ? 1.3 : 1.0))
          : Math.max(brakeSlip, latSlip * (load * 1.2));
        this.wheelSlipRatios[i] = slip;
      }
    }

    this.slipRatio = Math.max(
      this.wheelSlipRatios[0],
      this.wheelSlipRatios[1],
      this.wheelSlipRatios[2],
      this.wheelSlipRatios[3]
    );

    // --- 7. INTEGRATE WORLD VELOCITY (DUAL-AXIS TRACKING) ---
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const worldVx = (forwardX * this.speed) + (rightX * this.lateralSpeed);
    const worldVz = (forwardZ * this.speed) + (rightZ * this.lateralSpeed);

    this.position.x += worldVx * clampedDt;
    this.position.z += worldVz * clampedDt;

    // --- 8. CHASSIS BODY LEAN DYNAMICS & PUNCTURE SHUDDER WOBBLE ---
    // Rhythmic vibration / thumping when driving on flat tire
    if (hasPuncture && speedKmh > 2.0) {
      const wobbleFreq = this.wheelRotations[0] * 2.0;
      this.punctureWobble = Math.sin(wobbleFreq) * 0.028 * Math.min(1.0, speedKmh / 20.0);
    } else {
      this.punctureWobble = 0;
    }

    this.pitch = this.punctureWobble * 0.5; // Pitch shudder
    const maxRoll = 0.040;
    const targetRoll = THREE.MathUtils.clamp(lateralG * 0.022, -maxRoll, maxRoll) + this.punctureWobble;
    this.roll += (targetRoll - this.roll) * Math.min(1.0, 18.0 * clampedDt);

    // --- 9. FORWARD WHEEL ROLLING (HANDBRAKE LOCKS REAR WHEELS) ---
    const wheelRotSpeed = this.speed / (2.05 / (2 * Math.PI));
    this.wheelRotations[0] += wheelRotSpeed * clampedDt;
    this.wheelRotations[1] += wheelRotSpeed * clampedDt;

    if (inputs.handbrake && absSpeed > 0.5) {
      // Rear wheels lock under handbrake
    } else {
      this.wheelRotations[2] += wheelRotSpeed * clampedDt;
      this.wheelRotations[3] += wheelRotSpeed * clampedDt;
    }
  }

  private updateTransmission(dt: number, throttle: number, powerFactor: number): void {
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.isShifting = false;
      }
    }

    if (this.gear === -1) {
      const targetReverseRpm = Math.min(this.maxRpm, this.idleRpm + Math.abs(this.speed) * 420 + throttle * 1500);
      this.rpm += (targetReverseRpm - this.rpm) * (1.0 - Math.exp(-14.0 * dt));
      this.rpm = THREE.MathUtils.clamp(this.rpm, this.idleRpm, this.maxRpm);
      return;
    }

    const currentRatio = this.gearRatios[this.gear - 1] || 1.0;
    const speedRatioRpm = (Math.abs(this.speed) * currentRatio * this.finalDrive * 60) / 2.05;

    // Progressive Launch Clutch Model (eliminates RPM collapse and acceleration jolt)
    // In 1st gear, clutch smoothly locks up from 0 to 4.5 m/s (~16.2 km/h)
    const clutchEngagement = this.gear === 1
      ? Math.min(1.0, Math.max(0.0, Math.abs(this.speed) / 4.5))
      : 1.0;

    const launchTargetRpm = this.idleRpm + Math.pow(throttle, 1.15) * 5200;
    const targetRpm = THREE.MathUtils.lerp(
      launchTargetRpm,
      Math.max(this.idleRpm, speedRatioRpm),
      clutchEngagement
    );

    const rpmResponseRate = this.isShifting ? 32.0 : 18.0;
    this.rpm += (targetRpm - this.rpm) * (1.0 - Math.exp(-rpmResponseRate * dt));
    this.rpm = THREE.MathUtils.clamp(this.rpm, this.idleRpm, this.maxRpm);

    // Upshift at 8900 RPM with calibrated racing speed gates per gear
    const minUpshiftSpeed = this.gear === 1 ? 23.5 : (this.gear === 2 ? 39.0 : (this.gear === 3 ? 54.0 : (this.gear === 4 ? 68.0 : 80.0)));
    if (!this.isShifting && this.gear < 6 && this.rpm > 8900 * powerFactor && this.speed > minUpshiftSpeed) {
      this.gear++;
      this.isShifting = true;
      this.shiftTimer = 0.055;
      if (this.onBackfire) this.onBackfire(false);
    }
    // Downshift below 2800 RPM with wide hysteresis
    else if (!this.isShifting && this.gear > 1 && this.rpm < 2800 && this.speed < minUpshiftSpeed * 0.82) {
      this.gear--;
      this.isShifting = true;
      this.shiftTimer = 0.055;
    }

    // --- ENGINE TEMPERATURE THERMODYNAMICS (°C) ---
    const rpmLoad = (this.rpm - this.idleRpm) / (this.maxRpm - this.idleRpm);
    const radiatorCooling = (Math.min(1.0, Math.abs(this.speed) / 75.0) * 8.0);
    const targetTemp = 85.0 + (rpmLoad * 32.0) + (throttle * 16.0) - radiatorCooling;
    this.engineTemp += (targetTemp - this.engineTemp) * (1.0 - Math.exp(-0.45 * dt));
  }

  public handleCollision(
    normalX: number,
    normalZ: number,
    penetration: number,
    isStaticSolid: boolean = true
  ): void {
    // 1. Damped penetration correction: prevent abrupt multi-meter snapping / jumping
    const smoothPush = Math.min(penetration, 0.16);
    this.position.x += normalX * smoothPush;
    this.position.z += normalZ * smoothPush;

    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const carVx = forwardX * this.speed + rightX * this.lateralSpeed;
    const carVz = forwardZ * this.speed + rightZ * this.lateralSpeed;

    const normalDot = carVx * normalX + carVz * normalZ;

    if (normalDot < 0) {
      const impactSpeed = Math.abs(normalDot);
      const impactKmh = impactSpeed * 3.6;

      // 2. Structural Plastic Dissipation: F1 carbon crash structures absorb ~85-92% of normal energy
      const restitution = isStaticSolid ? 0.05 : 0.20; // minimal elastic rebound
      const impulse = -(1 + restitution) * normalDot;

      // New velocity vector after normal impulse
      const newVx = carVx + impulse * normalX;
      const newVz = carVz + impulse * normalZ;

      // Project onto vehicle forward & right axes
      const newFwdSpeed = newVx * forwardX + newVz * forwardZ;
      const newLatSpeed = newVx * rightX + newVz * rightZ;

      // Prevent abrupt reverse flick: if hitting frontally, don't fling car in reverse!
      this.speed = Math.max(-2.0, newFwdSpeed * 0.55);
      this.lateralSpeed = newLatSpeed * 0.40;

      // 3. Gentle glancing yaw alignment rather than violent spin-out
      const tangX = -normalZ;
      const tangZ = normalX;
      const tangDot = forwardX * tangX + forwardZ * tangZ;
      const alignSign = tangDot >= 0 ? 1 : -1;
      const targetTangYaw = Math.atan2(tangX * alignSign, tangZ * alignSign);
      let yawDiff = targetTangYaw - this.yaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

      // Blend angular velocity towards wall glancing tangent instead of wild kicks
      this.angularVelocity = THREE.MathUtils.clamp(yawDiff * 3.2, -2.6, 2.6);

      // 4. Directional Multi-Zone Structural Damage Assessment
      if (impactKmh > 10.0) {
        const damageAmount = Math.min(50, (impactKmh - 8) * 0.62);

        // Decompose impact direction in car local coordinates
        // localDot > 0: Frontal, localDot < 0: Rear
        // localRight > 0: Right side, localRight < 0: Left side
        const localDot = forwardX * -normalX + forwardZ * -normalZ;
        const localRight = rightX * -normalX + rightZ * -normalZ;

        if (localDot > 0.25) {
          // Frontal collision zone:
          const frontSeverity = Math.min(1.0, impactKmh / 140.0);
          this.damage.frontCrumple = Math.min(1.0, this.damage.frontCrumple + frontSeverity * 0.65);
          this.damage.engineHealth = Math.max(10, this.damage.engineHealth - damageAmount * 0.75);

          // Asymmetric Front Wing & Endplate Damage in 4 Progressive Phases
          if (localRight < -0.15) {
            // Front-Left hit:
            this.damage.frontWingLeftDamage = Math.min(1.0, this.damage.frontWingLeftDamage + frontSeverity * 0.85 + 0.15);
            if (impactKmh > 20.0) this.damage.endplateLeftDetached = true;
            if (impactKmh > 32.0 || this.damage.frontWingLeftDamage > 0.55) this.damage.frontWingLeftUpperFlapDetached = true;
            if (impactKmh > 48.0 || this.damage.frontWingLeftDamage > 0.85) this.damage.frontWingLeftDetached = true;
            this.damage.suspensionLeft = Math.max(15, this.damage.suspensionLeft - damageAmount * 0.70);
            this.damage.suspensionCamberFL = Math.min(0.24, this.damage.suspensionCamberFL + frontSeverity * 0.18);
          } else if (localRight > 0.15) {
            // Front-Right hit:
            this.damage.frontWingRightDamage = Math.min(1.0, this.damage.frontWingRightDamage + frontSeverity * 0.85 + 0.15);
            if (impactKmh > 20.0) this.damage.endplateRightDetached = true;
            if (impactKmh > 32.0 || this.damage.frontWingRightDamage > 0.55) this.damage.frontWingRightUpperFlapDetached = true;
            if (impactKmh > 48.0 || this.damage.frontWingRightDamage > 0.85) this.damage.frontWingRightDetached = true;
            this.damage.suspensionRight = Math.max(15, this.damage.suspensionRight - damageAmount * 0.70);
            this.damage.suspensionCamberFR = Math.min(0.24, this.damage.suspensionCamberFR + frontSeverity * 0.18);
          } else {
            // Dead-center head-on: damages both sides
            this.damage.frontWingLeftDamage = Math.min(1.0, this.damage.frontWingLeftDamage + frontSeverity * 0.75 + 0.10);
            this.damage.frontWingRightDamage = Math.min(1.0, this.damage.frontWingRightDamage + frontSeverity * 0.75 + 0.10);
            if (impactKmh > 22.0) {
              this.damage.endplateLeftDetached = true;
              this.damage.endplateRightDetached = true;
            }
            if (impactKmh > 34.0) {
              this.damage.frontWingLeftUpperFlapDetached = true;
              this.damage.frontWingRightUpperFlapDetached = true;
            }
            if (impactKmh > 50.0) {
              this.damage.frontWingLeftDetached = true;
              this.damage.frontWingRightDetached = true;
            }
          }

          if (damageAmount > 20.0) {
            this.damage.wingLoose = true;
            this.damage.wingDamageAmount = Math.min(1.0, this.damage.wingDamageAmount + 0.35);
          }
        } else if (localDot < -0.25) {
          // Rear collision zone:
          const rearSeverity = Math.min(1.0, impactKmh / 130.0);
          this.damage.rearCrumple = Math.min(1.0, this.damage.rearCrumple + rearSeverity * 0.75);
          this.damage.wingLoose = true;
          this.damage.wingDamageAmount = Math.min(1.0, this.damage.wingDamageAmount + rearSeverity * 0.90 + 0.25);

          if (impactKmh > 30.0) {
            this.damage.drsFlapBroken = true;
          }
          if (localRight < -0.1) {
            this.damage.rearWingLeftDetached = true;
            this.damage.suspensionCamberRL = Math.min(0.20, this.damage.suspensionCamberRL + rearSeverity * 0.16);
          } else if (localRight > 0.1) {
            this.damage.rearWingRightDetached = true;
            this.damage.suspensionCamberRR = Math.min(0.20, this.damage.suspensionCamberRR + rearSeverity * 0.16);
          } else {
            if (impactKmh > 40.0) {
              this.damage.rearWingLeftDetached = true;
              this.damage.rearWingRightDetached = true;
            }
          }
        } else {
          // Flank / Side impact:
          const flankSeverity = Math.min(1.0, impactKmh / 110.0);
          if (localRight > 0) {
            this.damage.suspensionRight = Math.max(15, this.damage.suspensionRight - damageAmount * 0.85);
            this.damage.suspensionCamberFR = Math.min(0.24, this.damage.suspensionCamberFR + flankSeverity * 0.20);
            this.damage.suspensionCamberRR = Math.min(0.20, this.damage.suspensionCamberRR + flankSeverity * 0.15);
            this.damage.frontWingRightDamage = Math.min(1.0, this.damage.frontWingRightDamage + flankSeverity * 0.5);
            if (impactKmh > 28.0) this.damage.endplateRightDetached = true;
            if (impactKmh > 45.0) this.damage.rearWingRightDetached = true;
          } else {
            this.damage.suspensionLeft = Math.max(15, this.damage.suspensionLeft - damageAmount * 0.85);
            this.damage.suspensionCamberFL = Math.min(0.24, this.damage.suspensionCamberFL + flankSeverity * 0.20);
            this.damage.suspensionCamberRL = Math.min(0.20, this.damage.suspensionCamberRL + flankSeverity * 0.15);
            this.damage.frontWingLeftDamage = Math.min(1.0, this.damage.frontWingLeftDamage + flankSeverity * 0.5);
            if (impactKmh > 28.0) this.damage.endplateLeftDetached = true;
            if (impactKmh > 45.0) this.damage.rearWingLeftDetached = true;
          }
        }

        this.damage.overallHealth = Math.max(0, this.damage.overallHealth - damageAmount);
        if (this.damage.overallHealth <= 0) {
          this.damage.isTotaled = true;
        }

        if (this.onCrash) {
          this.onCrash(impactSpeed);
        }
      }
    }
  }

  private updatePitRepair(dt: number): void {
    if (this.isInPitStop && Math.abs(this.speed) < 2.0) {
      if (
        this.damage.overallHealth < 100 ||
        this.damage.engineHealth < 100 ||
        this.damage.frontCrumple > 0 ||
        this.damage.frontWingLeftDamage > 0 ||
        this.damage.frontWingRightDamage > 0 ||
        this.damage.frontWingLeftDetached ||
        this.damage.frontWingRightDetached ||
        this.damage.rearWingLeftDetached ||
        this.damage.rearWingRightDetached ||
        this.damage.drsFlapBroken
      ) {
        const repairRate = 34.0;
        this.damage.overallHealth = Math.min(100, this.damage.overallHealth + repairRate * dt);
        this.damage.engineHealth = Math.min(100, this.damage.engineHealth + repairRate * dt);
        this.damage.suspensionLeft = Math.min(100, this.damage.suspensionLeft + repairRate * dt);
        this.damage.suspensionRight = Math.min(100, this.damage.suspensionRight + repairRate * dt);
        this.damage.frontCrumple = Math.max(0, this.damage.frontCrumple - (0.38 * dt));
        this.damage.rearCrumple = Math.max(0, this.damage.rearCrumple - (0.38 * dt));
        this.damage.frontWingLeftDamage = Math.max(0, this.damage.frontWingLeftDamage - (0.45 * dt));
        this.damage.frontWingRightDamage = Math.max(0, this.damage.frontWingRightDamage - (0.45 * dt));
        this.damage.wingDamageAmount = Math.max(0, this.damage.wingDamageAmount - (0.45 * dt));
        this.damage.suspensionCamberFL = Math.max(0, this.damage.suspensionCamberFL - (0.2 * dt));
        this.damage.suspensionCamberFR = Math.max(0, this.damage.suspensionCamberFR - (0.2 * dt));
        this.damage.suspensionCamberRL = Math.max(0, this.damage.suspensionCamberRL - (0.2 * dt));
        this.damage.suspensionCamberRR = Math.max(0, this.damage.suspensionCamberRR - (0.2 * dt));
        this.damage.frontWingLeftUpperFlapDetached = false;
        this.damage.frontWingRightUpperFlapDetached = false;
        this.damage.frontWingLeftDetached = false;
        this.damage.frontWingRightDetached = false;
        this.damage.endplateLeftDetached = false;
        this.damage.endplateRightDetached = false;
        this.damage.rearWingLeftDetached = false;
        this.damage.rearWingRightDetached = false;
        this.damage.drsFlapBroken = false;
        this.damage.wingLoose = false;
        this.damage.isTotaled = false;

        this.pitRepairProgress = this.damage.overallHealth / 100;

        if (this.damage.overallHealth >= 99.8) {
          this.repairFull();
          if (this.onPitFinish) {
            this.onPitFinish();
          }
        }
      }
    } else {
      this.pitRepairProgress = 0;
    }
  }

  /**
   * Sub-frame temporal interpolation: position
   */
  public getInterpolatedPosition(alpha: number, out: THREE.Vector3): void {
    out.x = this.prevPosition.x + (this.position.x - this.prevPosition.x) * alpha;
    out.y = this.prevPosition.y + (this.position.y - this.prevPosition.y) * alpha;
    out.z = this.prevPosition.z + (this.position.z - this.prevPosition.z) * alpha;
  }

  /**
   * Sub-frame temporal interpolation: yaw with wrap-around correction
   */
  public getInterpolatedYaw(alpha: number): number {
    let diff = this.yaw - this.prevYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return this.prevYaw + diff * alpha;
  }

  /**
   * Sub-frame temporal interpolation: pitch
   */
  public getInterpolatedPitch(_alpha: number): number {
    return 0;
  }

  /**
   * Sub-frame temporal interpolation: roll
   */
  public getInterpolatedRoll(alpha: number): number {
    return this.prevRoll + (this.roll - this.prevRoll) * alpha;
  }
}
