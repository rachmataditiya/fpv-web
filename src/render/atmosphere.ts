import * as THREE from 'three';
import { WEATHERS, type WeatherId } from '../game/weatherTable';

/**
 * Manages weather-specific atmospheric lighting and fog.
 * Creates its own hemisphere and directional light, and directly
 * overwrites scene.fog and scene.background.
 *
 * Usage:
 *   const atmosphere = new Atmosphere(scene);
 *   atmosphere.apply('dust_storm');
 *   atmosphere.dispose();
 */
export class Atmosphere {
  private readonly scene: THREE.Scene;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;

  /** Weather currently applied (or initial default) */
  private _current: WeatherId = 'clear_day';

  /** Saved original fog and background for disposal */
  private readonly originalFog: THREE.FogBase | null;
  private readonly originalBackground: THREE.Color | THREE.Texture | null;

  /**
   * @param scene The scene to control. Existing lights, fog, and background
   * are preserved internally for later restoration.
   */
  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Save initial environment before any modifications
    this.originalFog = scene.fog ?? null;
    this.originalBackground = scene.background ?? null;

    // Create the atmosphere's own lights (added once, never removed until disposal)
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    scene.add(this.hemiLight);
    scene.add(this.dirLight);
  }

  /** Getter for the currently applied weather id. */
  get current(): WeatherId {
    return this._current;
  }

  /**
   * Apply a weather profile. Can be called repeatedly; each call
   * updates the lights, fog, and background to match the given id.
   */
  apply(id: WeatherId): void {
    const spec = WEATHERS[id];
    this._current = id;

    // Update hemisphere light
    this.hemiLight.color.setHex(spec.skyColor);
    this.hemiLight.groundColor.setHex(spec.groundColor);
    this.hemiLight.intensity = spec.hemiIntensity;

    // Update directional light
    this.dirLight.color.setHex(spec.sunColor);
    this.dirLight.intensity = spec.sunIntensity;

    // Position the sun from altitude/azimuth (standard spherical coords)
    const altRad = THREE.MathUtils.degToRad(spec.sunAltitudeDeg);
    const azRad = THREE.MathUtils.degToRad(spec.sunAzimuthDeg);
    const x = Math.cos(azRad) * Math.cos(altRad);
    const y = Math.sin(altRad);
    const z = Math.sin(azRad) * Math.cos(altRad);
    this.dirLight.position.set(x, y, z).normalize();

    // Update scene fog
    this.scene.fog = new THREE.Fog(spec.fogColor, spec.fogNear, spec.fogFar);

    // Update scene background
    this.scene.background = new THREE.Color(spec.bgColor);
  }

  /**
   * Remove the atmosphere's lights from the scene and restore the
   * original fog and background that were present before construction.
   * Safe to call even if the scene has been modified externally.
   */
  dispose(): void {
    this.scene.remove(this.hemiLight);
    this.scene.remove(this.dirLight);

    // Restore original fog/background
    this.scene.fog = this.originalFog;
    this.scene.background = this.originalBackground;
  }
}
