/**
 * Very simple compatibility check for MVP.
 * - CPU socket must match motherboard socket
 * - PSU wattage must be >= (CPU_TDP + GPU_TDP) * 1.3
 */
function simpleCompatibilityCheck(partsMap) {
  const errors = [];
  const warnings = [];

  const cpu = partsMap.cpu;
  const motherboard = partsMap.motherboard;
  const gpu = partsMap.gpu;
  const psu = partsMap.psu;

  // CPU ↔ Motherboard socket check
  if (cpu && motherboard) {
    const cpuSocket = cpu.specs && cpu.specs.socket;
    const moboSocket = motherboard.specs && motherboard.specs.cpuSocket;

    if (cpuSocket && moboSocket && cpuSocket !== moboSocket) {
      errors.push(
        `CPU socket (${cpuSocket}) does not match motherboard socket (${moboSocket}).`
      );
    }
  }

  // PSU wattage check
  if (psu) {
    const psuWattage =
      (psu.specs && typeof psu.specs.wattage === "number"
        ? psu.specs.wattage
        : 0) || 0;
    const cpuTdp =
      (cpu && cpu.specs && typeof cpu.specs.tdp === "number"
        ? cpu.specs.tdp
        : 0) || 0;
    const gpuTdp =
      (gpu && gpu.specs && typeof gpu.specs.tdp === "number"
        ? gpu.specs.tdp
        : 0) || 0;

    const required = (cpuTdp + gpuTdp) * 1.3; // 30% headroom

    if (psuWattage < required) {
      errors.push(
        `PSU wattage (${psuWattage}W) is below estimated required wattage (${Math.round(
          required
        )}W).`
      );
    }
  }

  const status = errors.length ? "error" : "ok";

  return { status, errors, warnings };
}

module.exports = { simpleCompatibilityCheck };
