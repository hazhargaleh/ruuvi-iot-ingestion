/**
 * Saturation vapor pressure (improved Magnus formula, in Pa)
 * Valid between -40°C and +60°C — covers the RuuviTag range well
 */
export function equilibriumVaporPressure(temperatureC: number): number {
  const a = 17.625;
  const b = 243.04; // °C
  return 611.2 * Math.exp((a * temperatureC) / (b + temperatureC));
}

/**
 * Absolute humidity (g/m³)
 * Mass of water vapor per unit volume of air
 */
export function absoluteHumidity(temperatureC: number, relativeHumidityPct: number): number {
  const Rv = 461.5; // J/(kg·K) — specific heat capacity of water vapour
  const tempK = temperatureC + 273.15;
  const pv = (relativeHumidityPct / 100) * equilibriumVaporPressure(temperatureC);
  // ρv = pv / (Rv * T), to kg/m³ → converted to g/m³
  return (pv / (Rv * tempK)) * 1000;
}


/**
 * Density of humid air (kg/m³)
 * Ideal gas law with correction for water vapor
 */
export function airDensity(temperatureC: number, pressurePa: number, relativeHumidityPct: number): number {
  const Rd = 287.058; // J/(kg·K) — dry air constant
  const Rv = 461.5; // J/(kg·K) — vapour pressure
  const tempK = temperatureC + 273.15;
  const pv = (relativeHumidityPct / 100) * equilibriumVaporPressure(temperatureC);
  const pd = pressurePa - pv; // partial pressure of dry air
  return pd / (Rd * tempK) + pv / (Rv * tempK);
}

/**
 * Acceleration vector standard (g)
 */
export function accelerationTotal(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Angles of inclination from each axis (degrees)
 * arccos(component / norm) — returns NaN if the norm is zero
 */
export function accelerationAngles(
  x: number,
  y: number,
  z: number,
): { angleFromX: number; angleFromY: number; angleFromZ: number } {
  const total = accelerationTotal(x, y, z);
  if (total === 0) {
    return { angleFromX: NaN, angleFromY: NaN, angleFromZ: NaN };
  }
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  return {
    angleFromX: toDeg(Math.acos(x / total)),
    angleFromY: toDeg(Math.acos(y / total)),
    angleFromZ: toDeg(Math.acos(z / total)),
  };
}
