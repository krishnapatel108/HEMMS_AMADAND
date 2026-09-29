// ═══════════════════════════════════════════════════════════════
//  BEML 240T Dumper AI PM System — sensor-simulator.js
//  Simulates live CAN-Bus & OEM sensor readings with fault presets
// ═══════════════════════════════════════════════════════════════

'use strict';

class SensorSimulator {
  constructor() {
    this.currentDumper = 'BD-2401';
    this.status = 'operational'; // operational, idling, warning, shutdown
    this.rpm = 720;
    this.smu = 4820.50;
    
    // Telemetry baseline targets (what we drift towards)
    this.targets = {
      oilPressure: 4.2,      // bar
      coolantTemp: 83.0,     // °C
      exhaustTemp: 475.0,    // °C
      boostPressure: 2.1,    // bar
      blowbyPressure: 1.5,   // kPa
      alternatorVoltage: 720.0, // V
      wheelMotorTempL: 81.0,  // °C
      wheelMotorTempR: 82.0,  // °C
      gridTemp: 85.0,        // °C
      systemPressure: 195.0, // bar
      accumulatorGasPress: 90.0, // bar
      suspensionPressFront: 28.0, // bar
      suspensionPressRear: 29.0   // bar
    };

    // Current active telemetry values
    this.values = { ...this.targets };
    this.activeFault = 'normal'; // normal, engine-hot, low-oil, wheel-motor-hot, suspension-leak, grid-hot, blowby-crit
    
    this.intervalId = null;
    this.callbacks = [];
  }

  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000);
    console.log('🤖 OEM Telemetry Simulator Started.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  registerCallback(cb) {
    this.callbacks.push(cb);
  }

  // Set active fault scenario, changing the drift targets
  triggerFault(faultType) {
    this.activeFault = faultType;
    console.log(`⚠️ Simulator: Injecting fault scenario -> ${faultType.toUpperCase()}`);
    
    // Reset baseline targets first
    this.targets = {
      oilPressure: 4.2,
      coolantTemp: 83.0,
      exhaustTemp: 475.0,
      boostPressure: 2.1,
      blowbyPressure: 1.5,
      alternatorVoltage: 750.0,
      wheelMotorTempL: 81.0,
      wheelMotorTempR: 82.0,
      gridTemp: 90.0,
      systemPressure: 195.0,
      accumulatorGasPress: 90.0,
      suspensionPressFront: 28.0,
      suspensionPressRear: 29.0
    };

    // Trigger changes based on scenario
    switch (faultType) {
      case 'normal':
        this.status = 'operational';
        this.rpm = 700 + Math.random() * 1000; // random hauling speed
        break;
      
      case 'engine-hot':
        this.status = 'warning';
        this.targets.coolantTemp = 99.5;
        this.targets.exhaustTemp = 615.0;
        this.targets.boostPressure = 1.6; // low boost contributing to heat
        this.rpm = 1850; // high rev thermal strain
        break;

      case 'low-oil':
        this.status = 'shutdown';
        this.targets.oilPressure = 2.05; // critical low
        this.targets.coolantTemp = 91.0;  // slight heat rise
        this.rpm = 1400;
        break;

      case 'wheel-motor-hot':
        this.status = 'warning';
        this.targets.wheelMotorTempL = 109.5; // Left motor overheating
        this.targets.wheelMotorTempR = 80.0;  // Right motor normal load
        this.rpm = 1600;
        break;

      case 'suspension-leak':
        this.status = 'warning';
        this.targets.suspensionPressFront = 14.2; // Left/Right average drop
        this.rpm = 800; // reduced speed for safety
        break;

      case 'grid-hot':
        this.status = 'warning';
        this.targets.gridTemp = 215.0; // grid resistor cooling failure
        this.targets.alternatorVoltage = 850.0; // retarder braking peak voltage
        this.rpm = 1900; // high rpm retarder haul
        break;
        
      case 'blowby-crit':
        this.status = 'warning';
        this.targets.blowbyPressure = 13.8; // critical piston blow-by
        this.targets.oilPressure = 3.1;    // dropping oil pressure
        this.rpm = 1800;
        break;
    }
  }

  // Update simulator values, drifting towards target values
  tick() {
    this.smu += (this.rpm / 3600) * 0.05; // increment hours based on RPM

    // Drift actual readings toward targets with a small random noise
    for (const key of Object.keys(this.values)) {
      const target = this.targets[key];
      const current = this.values[key];
      const diff = target - current;
      
      // Step amount based on parameter scale
      let step = diff * 0.15; // smooth drift
      
      // Add slight micro-fluctuations (sensor noise)
      let noise = 0;
      if (key === 'rpm') {
        noise = (Math.random() - 0.5) * 10;
      } else if (key.toLowerCase().includes('temp') || key.toLowerCase().includes('voltage')) {
        noise = (Math.random() - 0.5) * 0.5;
      } else {
        noise = (Math.random() - 0.5) * 0.03;
      }

      this.values[key] = Number((current + step + noise).toFixed(2));
      
      // Bound checking to prevent negative values
      if (this.values[key] < 0) this.values[key] = 0;
    }

    // Call registered UI callbacks
    this.callbacks.forEach(cb => cb({
      dumper_no: this.currentDumper,
      status: this.status,
      rpm: Math.round(this.rpm + (Math.random() - 0.5) * 8),
      smu: this.smu,
      activeFault: this.activeFault,
      telemetry: { ...this.values }
    }));
  }
}
