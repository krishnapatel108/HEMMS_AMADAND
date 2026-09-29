// ═══════════════════════════════════════════════════════════════
//  BEML 240T Dumper AI PM System — ai-engine.js
//  Multi-Sensor Fusion Diagnostics and Consumables Wear RUL Model
// ═══════════════════════════════════════════════════════════════

'use strict';

// Feature mappings between CSV column names and live JS object keys
const SENSOR_MAP = {
  oilPressure: 'engine_oil_pressure',
  coolantTemp: 'engine_coolant_temp',
  exhaustTemp: 'engine_exhaust_temp',
  boostPressure: 'turbo_boost_pressure',
  blowbyPressure: 'crankcase_blowby',
  alternatorVoltage: 'main_alternator_voltage',
  wheelMotorTempL: 'wheel_motor_temp_l',
  wheelMotorTempR: 'wheel_motor_temp_r',
  gridTemp: 'retarder_grid_temp',
  systemPressure: 'hydraulic_pump_pressure',
  accumulatorGasPress: 'steering_accumulator_pressure',
  suspensionPressFront: 'suspension_pressure_front',
  suspensionPressRear: 'suspension_pressure_rear'
};

const OP_MAP = {
  steeringStiff: 'operator_stiff_steering',
  oilDripping: 'operator_oil_dripping',
  tireDamage: 'operator_tire_damage',
  afdssDischarged: 'operator_afdss_red'
};

const CLASSES = ['Engine', 'Drive System', 'Hydraulics', 'Suspension', 'Normal'];

class AIEngine {
  constructor() {}

  // ── Multi-Sensor Fusion Diagnostics ──
  // Correlates telemetry readings and operator shift checklist complaints
  static diagnose(telemetry, operatorChecks) {
    const findings = [];
    const actions = [];
    let severity = 'healthy';
    let rootCause = 'All mechanical, electrical, and hydraulic sub-systems are within standard OEM nominal bounds.';
    let troubleshoot = 'Perform standard daily visual checks and keep grease auto-lube reservoirs topped up.';

    const tel = telemetry;
    const op = operatorChecks || {};

    // 1. Check for trained AI model predictions in localStorage
    let trainedAlerts = null;
    try {
      const modelStr = localStorage.getItem('beml_trained_model');
      if (modelStr) {
        const model = JSON.parse(modelStr);
        const threshold = parseInt(localStorage.getItem('beml_reliability_threshold') || '60', 10);
        const predictions = AIEngine.predictModel(model, tel, op);
        
        let bestClass = 'Normal';
        let bestProb = 0;
        for (const [cls, prob] of Object.entries(predictions)) {
          if (prob > bestProb) {
            bestProb = prob;
            bestClass = cls;
          }
        }
        
        if (bestClass !== 'Normal' && (bestProb * 100) >= threshold) {
          trainedAlerts = {
            cls: bestClass,
            prob: bestProb,
            predictions
          };
        }
      }
    } catch (err) {
      console.error('Error running trained AI prediction:', err);
    }

    // 2. Static Heuristic Fallbacks (Run always for dual-safety check)
    // Scenario 1: Low Oil Pressure (Cummins QSK60)
    if (tel.oilPressure < 2.2) {
      severity = 'critical';
      findings.push('CRITICAL: Extreme Low Engine Oil Pressure (' + tel.oilPressure + ' bar)');
      actions.push('DGMS SAFETY ORDER: Shutdown engine immediately. Do not attempt to crawl dumper to shop.');
      rootCause = 'Critical failure of engine lubrication flow. Likely caused by main pump suction piping breakage, stuck open safety relief valve, or severe crankcase shell bearing wear.';
      troubleshoot = '1. Check oil dipstick for metal particles.\n2. Disassemble lubrication pressure regulator and inspect spring.\n3. Fit manual mechanical gauge to engine gallery block to rule out sender sensor fault.\n4. Take oil sample to check for diesel fuel dilution.';
    } else if (tel.oilPressure < 3.0) {
      if (severity !== 'critical') severity = 'warning';
      findings.push('WARNING: Low Oil Pressure (' + tel.oilPressure + ' bar)');
      actions.push('Monitor engine oil warning light. Park dumper at next safe dump cycle.');
      rootCause = 'Marginal oil pressure. Indicates primary lube filters clogging or engine running at high thermal load thinning the oil.';
      troubleshoot = '1. Replace engine lube oil spin-on filters and bypass elements.\n2. Inspect oil cooler block fins for coal dust blockages. Wash if dirty.';
    }

    // Scenario 2: Engine Overheating + Low Boost (Radiator / Fan drive slip)
    if (tel.coolantTemp > 95 || tel.exhaustTemp > 590) {
      severity = 'critical';
      findings.push('CRITICAL: Engine Thermal Overload (Coolant: ' + tel.coolantTemp + '°C, Exhaust: ' + tel.exhaustTemp + '°C)');
      actions.push('Stop haul truck. Run engine at low idle speed (approx 700 RPM) for 5 minutes to stabilize temps, then shut down.');
      rootCause = 'Cummins QSK60 overheating. Low boost pressure (' + tel.boostPressure + ' bar) indicates lack of charge air, causing rich combustion fuel-to-air ratio, driving exhaust and coolant temperatures up.';
      troubleshoot = '1. Check radiator hydraulic fan motor rotation speed using photo-tachometer.\n2. Pressure test aftercooler core to inspect for boost charge air leakage.\n3. Clean coal dust debris from radiator grille using high-pressure steam washer.';
    } else if (tel.coolantTemp > 90) {
      if (severity !== 'critical') severity = 'warning';
      findings.push('WARNING: High Engine Coolant Temperature (' + tel.coolantTemp + '°C)');
      actions.push('Reduce hauling speed on uphill grades. Keep gear ratio locked in manual to prevent torque converter slippage.');
      rootCause = 'High thermal load on cooling package. Typical under high ambient mining shifts.';
      troubleshoot = '1. Check header tank coolant level. Top up with water-antifreeze mix.\n2. Verify radiator cooling fan shutter solenoid opens fully.';
    }

    // Scenario 3: Piston Ring / Cylinder liner wear (Blow-by + Sump drop)
    if (tel.blowbyPressure > 8.0) {
      if (tel.oilPressure < 3.5) {
        severity = 'critical';
        findings.push('CRITICAL: High Blow-by (' + tel.blowbyPressure + ' kPa) and Low Oil Pressure (' + tel.oilPressure + ' bar)');
        actions.push('Move dumper directly to workshop. Limit engine RPM to 1200.');
        rootCause = 'Multi-Sensor Fusion shows combustion gas blowing past piston rings into oil crankcase, heating oil and lowering pressure. High risk of piston seizure or crankcase explosion.';
        troubleshoot = '1. Run engine compression check and cylinder leak-down test.\n2. Check crankcase breather tubes for heavy sludge blocks. Clean tubes.\n3. Inspect cylinder liners with borescope for scuffing/scoring marks.';
      } else {
        if (severity !== 'critical') severity = 'warning';
        findings.push('WARNING: Elevated Engine Blow-by (' + tel.blowbyPressure + ' kPa)');
        actions.push('Schedule compression test at next 250 Hr service round.');
        rootCause = 'Piston rings starting to wear out. Combustion gases beginning to enter oil pan.';
        troubleshoot = '1. Inspect and replace crankcase breather separator elements.\n2. Take engine oil sample to check for high soot loading and soot dilution.';
      }
    }

    // Scenario 4: GE AC Drive Grid Resistor Blower Failure
    if (tel.gridTemp > 180) {
      severity = 'critical';
      findings.push('CRITICAL: Dynamic Braking Grid Resistor Overtemperature (' + tel.gridTemp + '°C)');
      actions.push('DGMS SAFETY ALERT: Avoid using dynamic retarder brake. Operator must control dumper using service brakes and park immediately.');
      rootCause = 'GE GTA22 drive system dynamic retarder blower cooling system failure. Blower fan motor is seized or grid contacts are burnt.';
      troubleshoot = '1. Inspect dynamic braking grid blower contactor switch and clean burnt tips.\n2. Measure electrical resistance of dynamic retarding grids.\n3. Verify blower rotor shaft spins freely manually.';
    }

    // Scenario 5: Stiff steering + low accumulator pressure (Combined sensor + operator input)
    if (tel.accumulatorGasPress < 75 || op.steeringStiff) {
      if (tel.accumulatorGasPress < 75 && op.steeringStiff) {
        severity = 'critical';
        findings.push('CRITICAL: Emergency Steering System Fault (N2: ' + tel.accumulatorGasPress + ' bar + Operator Stiff Steering)');
        actions.push('DGMS ALERT: Unsafe for operation. Emergency steering reserve is lost. Immediate workshop towing required.');
        rootCause = 'Steering accumulators gas charge has completely bled off or bladder has ruptured. Steering oil priority circuit spool valve is stuck.';
        troubleshoot = '1. Bleed off hydraulic pressure safely from manifold.\n2. Re-charge nitrogen gas pre-charge inside accumulators using nitrogen bottle to 90 bar.\n3. Replace internal accumulator rubber bladder seal if it fails to hold gas pressure.\n4. Clean priority valve spool.';
      } else if (tel.accumulatorGasPress < 80) {
        if (severity !== 'critical') severity = 'warning';
        findings.push('WARNING: Low Steering Accumulator N2 Pre-Charge (' + tel.accumulatorGasPress + ' bar)');
        actions.push('Schedule accumulator pressure top-up on next shift shutdown.');
        rootCause = 'Slow nitrogen gas pressure bleed off from steering steel cylinder accumulator seals.';
        troubleshoot = '1. Connect gas pressure charging kit and top up Nitrogen gas to 90 bar.';
      } else if (op.steeringStiff) {
        if (severity !== 'critical') severity = 'warning';
        findings.push('WARNING: Operator Reports Stiff Steering');
        actions.push('Run steering relief valve pressure test in workshop.');
        rootCause = 'Steering pump flow rate low or hydraulic suction line aerating oil.';
        troubleshoot = '1. Measure hydraulic steering steering pressure (normal: 195 bar).\n2. Replace hydraulic return line filters.';
      }
    }

    // Scenario 6: Left Wheel Motor Bearing Wear
    if (tel.wheelMotorTempL > 100 && tel.wheelMotorTempR < 85) {
      severity = 'critical';
      findings.push('CRITICAL: Left Wheel Motor Bearing Overheat (Left: ' + tel.wheelMotorTempL + '°C, Right: ' + tel.wheelMotorTempR + '°C)');
      actions.push('Drive truck slowly to shop. Do not load tray.');
      rootCause = 'Left traction motor bearing lubrication oil failure or air cooling connector bellows torn, starving Left motor of coolant airflow.';
      troubleshoot = '1. Check Left wheel motor rubber cooling duct bellows for tears/slits. Replace bellows.\n2. Clean wheel motor inlet air screens.\n3. Take oil sample from final drive wheel assembly to inspect for metallic bronze flakes indicating bearing wear.';
    }

    // Scenario 7: Suspension Gas Leakage
    if (tel.suspensionPressFront < 18 || tel.suspensionPressRear < 18) {
      if (severity !== 'critical') severity = 'warning';
      findings.push('WARNING: Low Suspension Strut Pressure (Front: ' + tel.suspensionPressFront + ' bar, Rear: ' + tel.suspensionPressRear + ' bar)');
      actions.push('Check cylinder heights. Do not run dumper overloaded.');
      rootCause = 'Gas/Oil leakage in hydro-pneumatic suspension cylinders, causing dumper frame to sit unevenly and stress welds.';
      troubleshoot = '1. Measure suspension rod extension heights (should be 190mm unladen).\n2. Recharge cylinder struts with transformer oil and dry nitrogen gas slowly using charging kit to nominal pressures.';
    }

    // Operator Pre-Start checklists general alerts
    if (op.oilDripping) {
      if (severity !== 'critical') severity = 'warning';
      findings.push('WARNING: Operator Reported Fluid Leakage');
      actions.push('Locate leakage source in engine engine bay/hose connections.');
    }
    if (op.tireDamage) {
      severity = 'critical';
      findings.push('CRITICAL: Operator Reported Tire Damage (Cuts/Bead separation)');
      actions.push('Unsafe for haul. Tire blowout risk under 240T load. Swap tire in tire shop.');
    }
    if (op.afdssDischarged) {
      severity = 'critical';
      findings.push('CRITICAL: AFDSS Fire Suppression System Discharged/Gauge in Red');
      actions.push('DGMS SAFETY ORDER: Safety compliance violation. Do not run truck without fire suppression active.');
      troubleshoot = '1. Recharge chemical cylinder canisters.\n2. Replace melted thermal sensing cables over hot manifolds.';
    }

    // 3. Apply Trained AI prediction details if confidence matches threshold
    if (trainedAlerts) {
      const pct = (trainedAlerts.prob * 100).toFixed(0);
      findings.push(`🧠 AI MODEL PREDICTION (Trained Bayes): High risk of ${trainedAlerts.cls} failure (${pct}% confidence).`);
      
      // Elevate severity if predictions indicate critical confidence
      if (trainedAlerts.prob >= 0.8) {
        severity = 'critical';
      } else {
        if (severity !== 'critical') severity = 'warning';
      }
      
      // Provide custom trained root cause and troubleshooting
      if (trainedAlerts.cls === 'Engine') {
        rootCause = `[Trained AI model predicts Engine (Cummins QSK60) fault with ${pct}% confidence based on 1-yr logs.] ` + rootCause;
        troubleshoot = `[AI DIAGNOSTICS MANUAL OVERRIDE]:\n1. Connect INSITE tool to inspect active sensor thresholds.\n2. Review fuel/air filter flow parameters.\n3. Take oil sample to verify diesel soot levels.\n\n` + troubleshoot;
      } else if (trainedAlerts.cls === 'Drive System') {
        rootCause = `[Trained AI model predicts GE AC Drive System fault with ${pct}% confidence based on 1-yr logs.] ` + rootCause;
        troubleshoot = `[AI DIAGNOSTICS MANUAL OVERRIDE]:\n1. Clean and test dynamic retarding grid blower motors.\n2. Megger test wheel motor windings.\n3. Check high-voltage contactors.\n\n` + troubleshoot;
      } else if (trainedAlerts.cls === 'Hydraulics') {
        rootCause = `[Trained AI model predicts Hydraulic System fault with ${pct}% confidence based on 1-yr logs.] ` + rootCause;
        troubleshoot = `[AI DIAGNOSTICS MANUAL OVERRIDE]:\n1. Pre-charge steering accumulators with Nitrogen to 90 bar.\n2. Inspect and clean spool on priority safety block.\n3. Verify hoist cylinder pin lube ports.\n\n` + troubleshoot;
      } else if (trainedAlerts.cls === 'Suspension') {
        rootCause = `[Trained AI model predicts Suspension Strut fault with ${pct}% confidence based on 1-yr logs.] ` + rootCause;
        troubleshoot = `[AI DIAGNOSTICS MANUAL OVERRIDE]:\n1. Measure unladen cylinder chrome extension (nominal 190mm).\n2. Top up struts with Nitrogen gas (front 28 bar, rear 30 bar).\n3. Re-seal oil gland rings.\n\n` + troubleshoot;
      }
    }

    return {
      severity,
      findings,
      actions,
      rootCause,
      troubleshoot
    };
  }

  // ── Gaussian Naive Bayes Classifier Training ──
  static trainModel(dataset) {
    if (!dataset || dataset.length < 5) {
      throw new Error('Dataset must contain at least 5 records to train the Naive Bayes model.');
    }

    // Initialize counts and arrays per class
    const classCounts = {};
    const continuousData = {};
    const categoricalData = {};
    
    CLASSES.forEach(cls => {
      classCounts[cls] = 0;
      continuousData[cls] = {};
      categoricalData[cls] = {};
      
      Object.values(SENSOR_MAP).forEach(sKey => {
        continuousData[cls][sKey] = [];
      });
      
      Object.values(OP_MAP).forEach(oKey => {
        categoricalData[cls][oKey] = 0;
      });
    });

    let totalRows = 0;

    // Accumulate counts and parameters
    dataset.forEach(row => {
      const cls = row.fault_system;
      if (!CLASSES.includes(cls)) return;
      
      classCounts[cls]++;
      totalRows++;

      // Continuous Sensors
      Object.values(SENSOR_MAP).forEach(sKey => {
        const val = parseFloat(row[sKey]);
        if (!isNaN(val)) {
          continuousData[cls][sKey].push(val);
        }
      });

      // Categorical operator flags
      Object.values(OP_MAP).forEach(oKey => {
        const val = parseInt(row[oKey], 10);
        if (val === 1) {
          categoricalData[cls][oKey]++;
        }
      });
    });

    if (totalRows === 0) {
      throw new Error('No valid class labels found in training records.');
    }

    // Compute priors, Gaussian parameters, and Laplace binary likelihoods
    const model = {
      priors: {},
      gaussians: {},
      categoricals: {}
    };

    CLASSES.forEach(cls => {
      const count = classCounts[cls];
      model.priors[cls] = count / totalRows;

      model.gaussians[cls] = {};
      model.categoricals[cls] = {};

      // Numerical continuous features: calculate mean and variance
      Object.values(SENSOR_MAP).forEach(sKey => {
        const arr = continuousData[cls][sKey];
        if (arr.length === 0) {
          // Fallback if no records exist for this class
          model.gaussians[cls][sKey] = { mean: 0.0, variance: 1.0 };
          return;
        }
        
        const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
        const variance = arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length;
        
        model.gaussians[cls][sKey] = { mean, variance: Math.max(1e-4, variance) };
      });

      // Categorical operator inputs: Laplace smooth probability of 1
      Object.values(OP_MAP).forEach(oKey => {
        const trueCount = categoricalData[cls][oKey];
        const probTrue = (trueCount + 1) / (count + 2); // Laplace smoothing
        model.categoricals[cls][oKey] = probTrue;
      });
    });

    return model;
  }

  // Helper log-Gaussian probability density calculator
  static logGaussianPdf(x, mean, variance) {
    const val = Math.max(1e-4, variance);
    const diff = x - mean;
    return -0.5 * Math.log(2 * Math.PI) - 0.5 * Math.log(val) - (diff * diff) / (2 * val);
  }

  // Predict probabilities of each class given telemetry & operators
  static predictModel(model, telemetry, operatorChecks) {
    const scores = {};
    const predictions = {};

    CLASSES.forEach(cls => {
      // Prior probability in log space
      const prior = model.priors[cls] || 1e-5;
      let logScore = Math.log(Math.max(1e-5, prior));

      // Continuous sensors log-likelihood
      Object.entries(SENSOR_MAP).forEach(([telKey, csvKey]) => {
        const x = parseFloat(telemetry[telKey]);
        if (isNaN(x)) return;
        
        const params = model.gaussians[cls][csvKey];
        if (params) {
          const lp = AIEngine.logGaussianPdf(x, params.mean, params.variance);
          logScore += lp;
        }
      });

      // Operator checklist inputs log-likelihood
      Object.entries(OP_MAP).forEach(([opKey, csvKey]) => {
        const checked = operatorChecks[opKey] ? 1 : 0;
        const probTrue = model.categoricals[cls][csvKey] || 0.5;
        const lp = checked === 1 ? probTrue : (1.0 - probTrue);
        logScore += Math.log(Math.max(1e-9, lp));
      });

      scores[cls] = logScore;
    });

    // Convert log-likelihoods back to probabilities using exp normalization (softmax-like)
    let maxScore = -Infinity;
    CLASSES.forEach(cls => {
      if (scores[cls] > maxScore) maxScore = scores[cls];
    });

    let sumExp = 0;
    const expScores = {};
    CLASSES.forEach(cls => {
      const expVal = Math.exp(scores[cls] - maxScore);
      expScores[cls] = expVal;
      sumExp += expVal;
    });

    CLASSES.forEach(cls => {
      predictions[cls] = Number((expScores[cls] / (sumExp || 1)).toFixed(4));
    });

    return predictions;
  }

  // Evaluate accuracy, precision, recall, and build confusion matrix
  static evaluateModel(model, testSet) {
    let correct = 0;
    const actualCounts = {};
    const predictedCounts = {};
    const truePositives = {};

    CLASSES.forEach(cls => {
      actualCounts[cls] = 0;
      predictedCounts[cls] = 0;
      truePositives[cls] = 0;
    });

    const confusionMatrix = {};
    CLASSES.forEach(actual => {
      confusionMatrix[actual] = {};
      CLASSES.forEach(pred => {
        confusionMatrix[actual][pred] = 0;
      });
    });

    testSet.forEach(row => {
      const actual = row.fault_system;
      if (!CLASSES.includes(actual)) return;

      // Extract telemetry and operator checks structure from row to predict
      const telemetry = {};
      Object.entries(SENSOR_MAP).forEach(([telKey, csvKey]) => {
        telemetry[telKey] = parseFloat(row[csvKey]);
      });

      const operatorChecks = {};
      Object.entries(OP_MAP).forEach(([opKey, csvKey]) => {
        operatorChecks[opKey] = parseInt(row[csvKey], 10) === 1;
      });

      const predictions = AIEngine.predictModel(model, telemetry, operatorChecks);

      // Find predicted class
      let predicted = 'Normal';
      let maxProb = -1;
      for (const [cls, prob] of Object.entries(predictions)) {
        if (prob > maxProb) {
          maxProb = prob;
          predicted = cls;
        }
      }

      actualCounts[actual]++;
      predictedCounts[predicted]++;
      confusionMatrix[actual][predicted]++;

      if (actual === predicted) {
        correct++;
        truePositives[actual]++;
      }
    });

    const accuracy = testSet.length > 0 ? correct / testSet.length : 1.0;

    let precisionSum = 0;
    let recallSum = 0;
    let validClassesPrec = 0;
    let validClassesRec = 0;

    CLASSES.forEach(cls => {
      const actualCount = actualCounts[cls];
      const predCount = predictedCounts[cls];
      const tp = truePositives[cls];

      if (actualCount > 0) {
        recallSum += (tp / actualCount);
        validClassesRec++;
      }
      if (predCount > 0) {
        precisionSum += (tp / predCount);
        validClassesPrec++;
      }
    });

    const precision = validClassesPrec > 0 ? precisionSum / validClassesPrec : 1.0;
    const recall = validClassesRec > 0 ? recallSum / validClassesRec : 1.0;

    return {
      accuracy: Number(accuracy.toFixed(4)),
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      confusionMatrix
    };
  }

  // ── Consumables Wear & Remaining Useful Life (RUL) Model ──
  // Models wear degradation index based on SMU hours and telemetry stress parameters
  static calculateRUL(smuHours, avgCoolantTemp = 84, avgBlowby = 1.5, suspensionUneven = false, offsets = {}) {
    const smu = Number(smuHours);
    const lastOil = Number(offsets.lastOil || 0);
    const lastFilter = Number(offsets.lastFilter || 0);
    const lastTire = Number(offsets.lastTire || 0);

    // 1. Engine Oil RUL (Service Life: 250 hours)
    const elapsedOil = smu - lastOil;
    const baseOilHrs = Math.max(0, 250 - elapsedOil);
    let oilStressMultiplier = 1.0;
    if (avgBlowby > 5.0) oilStressMultiplier += 0.3; // blowby soot load
    if (avgCoolantTemp > 90) oilStressMultiplier += 0.2; // thermal oxidation
    const oilRUL = Math.max(0, Number((baseOilHrs / oilStressMultiplier).toFixed(1)));
    const oilHealth = Number(((oilRUL / 250) * 100).toFixed(0));

    // 2. Air Intake Filters RUL (Service Life: 500 hours)
    const elapsedFilter = smu - lastFilter;
    const baseFilterHrs = Math.max(0, 500 - elapsedFilter);
    let filterStressMultiplier = 1.0;
    if (avgBlowby > 6.0) filterStressMultiplier += 0.4; // intake exhaust feedback
    const filterRUL = Math.max(0, Number((baseFilterHrs / filterStressMultiplier).toFixed(1)));
    const filterHealth = Number(((filterRUL / 500) * 100).toFixed(0));

    // 3. Tires (37R57) RUL (Service Life: 5000 hours)
    const elapsedTire = smu - lastTire;
    const baseTireHrs = Math.max(0, 5000 - elapsedTire);
    let tireStressMultiplier = 1.0;
    if (suspensionUneven) tireStressMultiplier += 0.5; // mechanical loading stress
    const tireRUL = Math.max(0, Number((baseTireHrs / tireStressMultiplier).toFixed(0)));
    const tireHealth = Number(((tireRUL / 5000) * 100).toFixed(0));

    // 4. Traction Motor Windings RUL (Design Life: 15,000 hours)
    const baseWindingHrs = 15000 - smu;
    const windingRUL = Math.max(0, Number(baseWindingHrs.toFixed(0)));
    const windingHealth = Number(((windingRUL / 15000) * 100).toFixed(0));

    return {
      oil: { hours: oilRUL, health: oilHealth },
      filters: { hours: filterRUL, health: filterHealth },
      tires: { hours: tireRUL, health: tireHealth },
      windings: { hours: windingRUL, health: windingHealth }
    };
  }
}
