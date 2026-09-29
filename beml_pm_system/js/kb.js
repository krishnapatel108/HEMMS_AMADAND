// ═══════════════════════════════════════════════════════════════
//  BEML 240T Dumper AI PM System — kb.js
//  OEM Standards & Diagnostic Fault Code Reference Database
// ═══════════════════════════════════════════════════════════════

'use strict';

const OEM_STANDARDS = {
  engine: {
    oilPressure: {
      name: 'Engine Oil Pressure',
      unit: 'bar',
      minNominal: 3.5,
      maxNominal: 5.5,
      lowAlarm: 3.0,
      critLow: 2.2,
      desc: 'Lube oil supply pressure to main crankshaft and camshaft bearings.'
    },
    coolantTemp: {
      name: 'Engine Coolant Temperature',
      unit: '°C',
      minNominal: 80,
      maxNominal: 92,
      highAlarm: 95,
      critHigh: 98,
      desc: 'Operating temperature of cylinder head block cooling water jacket.'
    },
    exhaustTemp: {
      name: 'Exhaust Gas Temperature',
      unit: '°C',
      minNominal: 450,
      maxNominal: 550,
      highAlarm: 580,
      critHigh: 620,
      desc: 'Average gas temperature at left and right turbocharger inlets.'
    },
    boostPressure: {
      name: 'Turbocharger Boost Pressure',
      unit: 'bar',
      minNominal: 2.0,
      maxNominal: 2.8,
      lowAlarm: 1.8,
      critLow: 1.5,
      desc: 'Compressed air pressure in the inlet manifold after charge-air cooler.'
    },
    blowbyPressure: {
      name: 'Crankcase Blow-by Pressure',
      unit: 'kPa',
      minNominal: 0.5,
      maxNominal: 3.0,
      highAlarm: 8.0,
      critHigh: 12.0,
      desc: 'Combustion gas leakage past piston rings into crankcase oil sump.'
    }
  },
  driveSystem: {
    alternatorVoltage: {
      name: 'GE Main Alternator Output',
      unit: 'V',
      minNominal: 600,
      maxNominal: 950,
      highAlarm: 1000,
      critHigh: 1050,
      desc: 'Main alternator GTA22 AC voltage delivered to traction rectifiers.'
    },
    wheelMotorTempL: {
      name: 'Left Traction Motor Winding Temp',
      unit: '°C',
      minNominal: 75,
      maxNominal: 90,
      highAlarm: 100,
      critHigh: 115,
      desc: 'Armature stator coil winding temperature of Left wheel motor.'
    },
    wheelMotorTempR: {
      name: 'Right Traction Motor Winding Temp',
      unit: '°C',
      minNominal: 75,
      maxNominal: 90,
      highAlarm: 100,
      critHigh: 115,
      desc: 'Armature stator coil winding temperature of Right wheel motor.'
    },
    gridTemp: {
      name: 'Retarding Resistor Grid Temp',
      unit: '°C',
      minNominal: 80,
      maxNominal: 150,
      highAlarm: 180,
      critHigh: 210,
      desc: 'Dynamic retarder resistor grids thermal status under downhill braking.'
    }
  },
  hydraulic: {
    systemPressure: {
      name: 'Steering/Hoist System Pressure',
      unit: 'bar',
      minNominal: 180,
      maxNominal: 210,
      lowAlarm: 170,
      critLow: 155,
      desc: 'Discharge oil pressure from primary steering and hoist pumps.'
    },
    accumulatorGasPress: {
      name: 'Steering Accumulator N2 Charge',
      unit: 'bar',
      minNominal: 85,
      maxNominal: 95,
      lowAlarm: 80,
      critLow: 70,
      desc: 'Dry Nitrogen pre-charge inside emergency steering steel accumulators.'
    },
    suspensionPressFront: {
      name: 'Front Suspension N2 Charge',
      unit: 'bar',
      minNominal: 25,
      maxNominal: 32,
      lowAlarm: 20,
      critLow: 15,
      desc: 'Operating load pressure in front hydro-pneumatic shock cylinders.'
    },
    suspensionPressRear: {
      name: 'Rear Suspension N2 Charge',
      unit: 'bar',
      minNominal: 26,
      maxNominal: 35,
      lowAlarm: 21,
      critLow: 16,
      desc: 'Operating load pressure in rear hydro-pneumatic shock cylinders.'
    }
  }
};

const CUMMINS_FAULT_CODES = {
  '143': {
    code: '143',
    sys: 'Engine Oil Pressure',
    desc: 'Lube Oil Pressure Low — Alarm Level',
    symptom: 'Engine power derate active. Amber warning light illuminated on dashboard console.',
    action: 'Monitor engine oil pressure gauge. Take oil sample immediately for dilution check. Top up oil if low.'
  },
  '415': {
    code: '415',
    sys: 'Engine Oil Pressure',
    desc: 'Lube Oil Pressure Low — Critical Level',
    symptom: 'Critical engine shutdown timer active (30s). Red stop lamp flashing. Major risk of engine seizure.',
    action: 'DGMS ALERT: Shut down the engine immediately. Inspect crankshaft bearing journals, clean engine oil bypass relief valves.'
  },
  '151': {
    code: '151',
    sys: 'Engine Coolant',
    desc: 'Coolant Temperature High — Severe Derate',
    symptom: 'Engine performance derated up to 30%. High fan speed active.',
    action: 'Check coolant levels in header tank. Inspect for fan belt slippage. High-pressure wash radiator matrix to clear coal dust.'
  },
  '234': {
    code: '234',
    sys: 'Engine Control',
    desc: 'Engine Overspeed Protection Active',
    symptom: 'Fuel injectors cut off to protect valves. Master warning horn sounding.',
    action: 'Reduce haul speed immediately. Check dynamic retarder grid blower functions. Verify lockup clutch release in converter.'
  },
  '598': {
    code: '598',
    sys: 'Engine Air Intake',
    desc: 'Air Intake Restriction Level Exceeded',
    symptom: 'Engine exhaust black smoke, low turbocharger boost pressure, loss of traction power.',
    action: 'Service engine primary air cleaner filters. Blow dry compressed air from inside out. Check for air intake duct leakage.'
  }
};

const GE_FAULT_CODES = {
  '501': {
    code: '501',
    sys: 'AC Drive Alternator',
    desc: 'Main Alternator Overtemperature Alarm',
    symptom: 'Traction horsepower limit active. Alternator fan high speed blower active.',
    action: 'Run dumper at low idle with no load to cool alternator windings. Check alternator cooling duct blockages.'
  },
  '512': {
    code: '512',
    sys: 'Retarder Grids',
    desc: 'Dynamic Retard Grid Blower Motor Overcurrent',
    symptom: 'Dynamic retarding brake disabled. Driver must rely only on service brake. Red alert lamp on panel.',
    action: 'Inspect grid blower fan for coal debris obstruction. Measure blower stator resistance. Clean contacts on blower switch panel.'
  },
  '522': {
    code: '522',
    sys: 'Traction Motors',
    desc: 'Traction Motor Stator Ground Fault Detected',
    symptom: 'AC Drive propulsion cut off. Dumper immobilized.',
    action: 'Perform megger insulation test on Left and Right wheel motors. Inspect motor power terminal block for water or grease contamination.'
  }
};
