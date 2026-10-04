/**
 * TouchControls.tsx - Ultra-Responsive Mobile Touch Controller with Calibrated Ergonomic Steering
 * Features:
 * - 0ms Synchronous Input Dispatch:
 *   * Dispatches steering, throttle, brake, and handbrake directly in pointer events (zero React frame lag).
 * - Full Thumb Height Reach (60vh):
 *   * Active touch zone covers the entire lower-left quadrant (height: 60vh) so it never misses a tap.
 * - Perfectly Calibrated Compact Width (~180px / 18% screen):
 *   * Left Turn: 0 to ~90px (right at the screen edge).
 *   * Right Turn: ~90px to ~180px (immediately adjacent, zero thumb stretching!).
 *   * Continuous thumb sliding between Left and Right with instant transition.
 * - DRS Button Positioned at Bottom-Left:
 *   * Sits neatly above the thumb area (bottom-36 / bottom-40 on left flank), completely clear of HUD.
 * - Translucent Pedals on Right Flank:
 *   * Semi-transparent Gas, Brake, and Drift with instantaneous synchronous feedback.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, ShieldAlert, Gauge, Wind } from 'lucide-react';
import { CarInputs } from '../game/physics/VehiclePhysics';

interface TouchControlsProps {
  onInputChange: (inputs: Partial<CarInputs>) => void;
  isDrsOpen?: boolean;
  isDrsAvailable?: boolean;
  onToggleDRS?: () => void;
}

export const TouchControls = React.memo<TouchControlsProps>(({
  onInputChange,
  isDrsOpen = false,
  isDrsAvailable = false,
  onToggleDRS,
}) => {
  const [steerState, setSteerState] = useState<'left' | 'right' | 'none'>('none');
  const [isGasActive, setIsGasActive] = useState(false);
  const [isBrakeActive, setIsBrakeActive] = useState(false);
  const [isDriftActive, setIsDriftActive] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  const leftSteerZoneRef = useRef<HTMLDivElement>(null);
  const steerPointerIdRef = useRef<number | null>(null);
  const rightPointerMap = useRef<Map<number, 'gas' | 'brake' | 'drift'>>(new Map());

  // Ref to always have latest onInputChange callback without stale closures
  const onInputChangeRef = useRef(onInputChange);
  useEffect(() => {
    onInputChangeRef.current = onInputChange;
  }, [onInputChange]);

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // --- ERGONOMIC STEERING LOGIC (Synchronous 0ms dispatch) ---
  const handleSteerPointer = useCallback((clientX: number) => {
    if (!leftSteerZoneRef.current) return;
    const rect = leftSteerZoneRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    
    // Split the active zone at 50% of the compact thumb cluster (width is ~180px)
    // Left: 0px to 90px (from bezel) -> Steer Left (1.0)
    // Right: 90px to 180px -> Steer Right (-1.0)
    const midX = rect.width * 0.5;
    const isLeft = relX < midX;
    const newState = isLeft ? 'left' : 'right';

    setSteerState(newState);
    onInputChangeRef.current({ steering: isLeft ? 1.0 : -1.0 });
  }, []);

  const handleSteerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    steerPointerIdRef.current = e.pointerId;
    handleSteerPointer(e.clientX);
  }, [handleSteerPointer]);

  const handleSteerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (steerPointerIdRef.current !== e.pointerId) return;
    handleSteerPointer(e.clientX);
  }, [handleSteerPointer]);

  const handleSteerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (steerPointerIdRef.current === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      steerPointerIdRef.current = null;
      setSteerState('none');
      onInputChangeRef.current({ steering: 0 });
    }
  }, []);

  // --- RIGHT PEDAL CLUSTER (Synchronous 0ms dispatch) ---
  const bindRightPointer = (action: 'gas' | 'brake' | 'drift') => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      rightPointerMap.current.set(e.pointerId, action);
      if (action === 'gas') {
        setIsGasActive(true);
        onInputChangeRef.current({ throttle: 1.0 });
      }
      if (action === 'brake') {
        setIsBrakeActive(true);
        onInputChangeRef.current({ brake: 1.0 });
      }
      if (action === 'drift') {
        setIsDriftActive(true);
        onInputChangeRef.current({ handbrake: true });
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      rightPointerMap.current.delete(e.pointerId);
      if (action === 'gas') {
        setIsGasActive(false);
        onInputChangeRef.current({ throttle: 0.0 });
      }
      if (action === 'brake') {
        setIsBrakeActive(false);
        onInputChangeRef.current({ brake: 0.0 });
      }
      if (action === 'drift') {
        setIsDriftActive(false);
        onInputChangeRef.current({ handbrake: false });
      }
    },
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
      rightPointerMap.current.delete(e.pointerId);
      if (action === 'gas') {
        setIsGasActive(false);
        onInputChangeRef.current({ throttle: 0.0 });
      }
      if (action === 'brake') {
        setIsBrakeActive(false);
        onInputChangeRef.current({ brake: 0.0 });
      }
      if (action === 'drift') {
        setIsDriftActive(false);
        onInputChangeRef.current({ handbrake: false });
      }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <div className="absolute inset-x-0 bottom-0 h-[65vh] flex justify-between pointer-events-none select-none z-30 touch-none">
      {/* =========================================================================
          LEFT FLANK: ERGONOMIC INVISIBLE STEERING SURFACE (0-180px compact reach)
          - Height: Full 60vh thumb sweep height (never misses a touch)
          - Width: ~180px / 18% width (Left: 0-90px, Right: 90-180px)
          - DRS Button neatly placed above
         ========================================================================= */}
      <div className="w-[180px] sm:w-[200px] h-full pointer-events-none relative flex flex-col justify-end items-start pb-3 sm:pb-5 pl-2 sm:pl-4">
        
        {/* DRS BUTTON: Floats neatly above the steering thumb rest */}
        <div className="pointer-events-auto mb-3 sm:mb-4">
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (onToggleDRS) onToggleDRS();
              else onInputChangeRef.current({ drs: !isDrsOpen });
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border transition-all select-none cursor-pointer active:scale-95 ${
              isDrsOpen
                ? 'bg-emerald-500/50 text-emerald-200 border-emerald-300/70 shadow-lg shadow-emerald-500/20 font-black'
                : isDrsAvailable
                ? 'bg-neutral-950/40 text-cyan-300 border-cyan-400/50 animate-pulse font-extrabold shadow-cyan-500/10'
                : 'bg-neutral-950/25 text-neutral-400/70 border-white/10 font-bold hover:bg-neutral-950/35'
            }`}
          >
            <Wind className="w-3.5 h-3.5" />
            <span className="text-[9px] font-black uppercase tracking-wider">
              DRS {isDrsOpen ? 'ON' : isDrsAvailable ? 'LISTO' : 'AUTO'}
            </span>
          </button>
        </div>

        {/* INVISIBLE STEERING TOUCH SURFACE (Height: 48vh, Width: 180px, Split at 90px) */}
        <div
          ref={leftSteerZoneRef}
          onPointerDown={handleSteerPointerDown}
          onPointerMove={handleSteerPointerMove}
          onPointerUp={handleSteerPointerUp}
          onPointerCancel={handleSteerPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full h-[48vh] pointer-events-auto relative touch-none select-none cursor-pointer flex"
        >
          {/* Subtle translucent visual feedback indicator when steering */}
          <div className="w-full h-full flex pointer-events-none rounded-2xl overflow-hidden">
            <div
              className={`w-1/2 h-full transition-opacity duration-75 ${
                steerState === 'left' ? 'bg-cyan-500/10 border-l-2 border-cyan-400/30 opacity-100' : 'opacity-0'
              }`}
            />
            <div
              className={`w-1/2 h-full transition-opacity duration-75 ${
                steerState === 'right' ? 'bg-cyan-500/10 border-r-2 border-cyan-400/30 opacity-100' : 'opacity-0'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Desktop Keyboard Helper Notice */}
      {!isTouchDevice && (
        <div className="hidden lg:flex absolute bottom-2 left-1/2 -translate-x-1/2 items-center gap-3 text-[10px] text-neutral-400 bg-neutral-950/60 px-4 py-1.5 rounded-xl border border-white/10 pointer-events-none z-10 shadow-lg">
          <span>Teclado: <b>W/↑</b> Gas · <b>S/↓</b> Freno · <b>A/D</b> Dirección · <b>ESPACIO</b> Drift · <b className="text-emerald-400">E / F</b> DRS · <b>C</b> Cámara · <b>B</b> Box</span>
        </div>
      )}

      {/* =========================================================================
          RIGHT ERGONOMIC TRANSLUCENT PEDAL CLUSTER
          - Semi-transparent styling (translucent dark with subtle glowing borders)
          - Drift button above
          - Gas & Brake side-by-side below
         ========================================================================= */}
      <div className="w-auto h-full pointer-events-auto relative flex flex-col justify-end items-end pb-3 sm:pb-5 pr-2 sm:pr-5 touch-none select-none">
        
        {/* UPPER ROW: DRIFT BUTTON */}
        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
          {/* DRIFT / FRENO DE MANO (Semi-transparent) */}
          <div
            {...bindRightPointer('drift')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl border cursor-pointer select-none transition-all active:scale-95 ${
              isDriftActive
                ? 'bg-amber-500/60 border-amber-300/80 text-amber-200 font-black shadow-lg shadow-amber-500/20 scale-105'
                : 'bg-neutral-950/40 border-amber-500/30 text-amber-300/80 font-bold hover:bg-neutral-950/50'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-wider">Drift</span>
          </div>
        </div>

        {/* LOWER ROW: FRENO & ACELERADOR (Semi-transparent side-by-side pedals) */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* FRENO / MARCHA ATRÁS PEDAL (Semi-transparent) */}
          <div
            {...bindRightPointer('brake')}
            className={`w-14 h-16 sm:w-16 sm:h-18 rounded-2xl border cursor-pointer select-none flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
              isBrakeActive
                ? 'bg-rose-500/60 border-rose-300/90 text-white shadow-lg shadow-rose-500/20 scale-105'
                : 'bg-neutral-950/40 border-rose-500/30 text-rose-300/80 hover:bg-neutral-950/50'
            }`}
          >
            <ShieldAlert className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-[9px] font-black uppercase tracking-wider">Freno</span>
          </div>

          {/* ACELERADOR / GAS PEDAL (Semi-transparent) */}
          <div
            {...bindRightPointer('gas')}
            className={`w-16 h-18 sm:w-18 sm:h-20 rounded-2xl border cursor-pointer select-none flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
              isGasActive
                ? 'bg-emerald-500/60 border-emerald-300/90 text-white shadow-lg shadow-emerald-500/20 scale-105'
                : 'bg-neutral-950/40 border-emerald-500/30 text-emerald-300/80 hover:bg-neutral-950/50'
            }`}
          >
            <Gauge className="w-7 h-7 sm:w-8 sm:h-8" />
            <span className="text-[10px] font-black uppercase tracking-wider">Gas</span>
          </div>
        </div>

      </div>
    </div>
  );
});
