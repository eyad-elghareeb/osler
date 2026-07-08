const fs = require("fs");
const path = require("path");
const TurndownService = require("turndown");

// --- Embed original article data ---
const articles = [
  {
    id: "art-stemi",
    title: "ST-Elevation Myocardial Infarction",
    specialty: "Cardiology",
    system: "Ischemic Syndrome",
    readTimeMin: 8,
    tags: ["emergency", "ischemia", "ECG"],
    // prettier-ignore
    html: `
<h1>ST-Elevation Myocardial Infarction (STEMI)</h1>
<p><strong>STEMI</strong> is a type of acute coronary syndrome characterized by complete occlusion of an epicardial coronary artery, resulting in transmural myocardial ischemia and ST-segment elevation on the ECG. It is a <strong>medical emergency</strong> requiring immediate reperfusion therapy.</p>

<h2>Pathophysiology</h2>
<p>STEMI most commonly results from rupture of an atherosclerotic plaque with subsequent thrombus formation, leading to complete occlusion of the coronary artery. The ensuing ischemia results in myocardial necrosis within 20–30 minutes if not relieved. The infarct begins subendocardially and extends transmurally as ischemia persists.</p>

<div class="callout"><strong>Key concept:</strong> "Time is muscle." Every minute of delay in reperfusion results in additional cardiomyocyte death. The goal is <strong>door-to-balloon time \u2264 90 minutes</strong> for primary PCI.</div>

<h2>Clinical Presentation</h2>
<p>The classic presentation of STEMI includes:</p>
<ul>
  <li><strong>Chest pain:</strong> Retrosternal, crushing/pressure-like, lasting &gt; 20 minutes, not relieved by rest or nitroglycerin</li>
  <li><strong>Radiation:</strong> To the left arm, jaw, neck, or back (in 30% of cases)</li>
  <li><strong>Associated symptoms:</strong> Diaphoresis, nausea, vomiting, dyspnea, palpitations</li>
  <li><strong>Atypical presentation:</strong> More common in women, diabetics, and the elderly — epigastric pain, fatigue, or syncope may be the only symptom</li>
</ul>

<h2>ECG Criteria</h2>
<p>ST-segment elevation in <strong>\u2265 2 contiguous leads</strong>:</p>
<table>
  <thead>
    <tr><th>Artery</th><th>Leads with ST elevation</th><th>Localization</th></tr>
  </thead>
  <tbody>
    <tr><td>LAD</td><td>V1\u2013V4</td><td>Anterior</td></tr>
    <tr><td>LAD (proximal)</td><td>V1\u2013V4 + I, aVL</td><td>Anterolateral</td></tr>
    <tr><td>LCx</td><td>I, aVL, V5\u2013V6</td><td>Lateral</td></tr>
    <tr><td>RCA</td><td>II, III, aVF</td><td>Inferior</td></tr>
    <tr><td>RCA (proximal)</td><td>II, III, aVF + V1</td><td>Inferior + RV infarct</td></tr>
  </tbody>
</table>

<div class="warning"><strong>Caution:</strong> In inferior STEMI, always obtain a <strong>right-sided ECG (V4R)</strong> to assess for RV involvement. RV infarct is preload-dependent — avoid nitrates, which can cause profound hypotension.</div>

<h2>Diagnosis</h2>
<p>The diagnosis of STEMI is made by ECG; do not wait for cardiac biomarkers. <strong>Troponin I/T</strong> rises within 3\u20134 hours, peaks at 18\u201324 hours, and remains elevated for 7\u201310 days. CK-MB is less specific but useful for detecting reinfarction (returns to baseline in 48\u201372 hours).</p>

<h2>Management</h2>
<h3>Initial Treatment (MONA-B)</h3>
<ul>
  <li><strong>M</strong>orphine: 2\u20134 mg IV for refractory pain (use sparingly — may delay antiplatelet absorption)</li>
  <li><strong>O</strong>xygen: Only if SpO\u2082 &lt; 90% (routine O\u2082 in normoxic patients increases mortality)</li>
  <li><strong>N</strong>itroglycerin: SL or IV for ongoing chest pain <em>(contraindicated in RV infarct, hypotension, recent PDE-5 inhibitor use)</em></li>
  <li><strong>A</strong>spirin: 162\u2013325 mg chewed immediately</li>
  <li><strong>B</strong>eta-blocker: Metoprolol 25 mg PO (IV only if hypertensive/tachycardic; <em>contraindicated in acute heart failure, hypotension, severe bronchospasm, advanced AV block</em>)</li>
</ul>

<h3>Reperfusion Therapy</h3>
<p><strong>Primary PCI</strong> is the preferred reperfusion strategy if it can be performed within <strong>120 minutes</strong> of first medical contact:</p>
<ul>
  <li>Door-to-balloon time \u2264 90 minutes</li>
  <li>Stent placement + aspiration thrombectomy if large thrombus burden</li>
  <li>Drug-eluting stent preferred — requires 12 months of dual antiplatelet therapy (DAPT)</li>
</ul>

<p>If PCI cannot be achieved within 120 minutes, <strong>fibrinolytic therapy</strong> with IV alteplase (tPA) or tenecteplase (TNK) should be given within 30 minutes of arrival ("door-to-needle time"). Fibrinolytics must be administered within <strong>12 hours</strong> of symptom onset.</p>

<h3>Adjunctive Medical Therapy</h3>
<ul>
  <li><strong>P2Y12 inhibitor:</strong> Ticagrelor 180 mg loading \u2192 90 mg BID, OR clopidogrel 600 mg loading \u2192 75 mg daily</li>
  <li><strong>Anticoagulation:</strong> Unfractionated heparin, enoxaparin, or bivalirudin during PCI</li>
  <li><strong>Statin:</strong> Atorvastatin 80 mg daily (high-intensity)</li>
  <li><strong>ACE inhibitor:</strong> Lisinopril within 24 hours (especially in anterior STEMI, LV dysfunction, or diabetes)</li>
  <li><strong>ARB:</strong> Valsartan if ACE inhibitor not tolerated</li>
</ul>

<h2>Complications</h2>
<h3>Early (\u2264 72 hours)</h3>
<ul>
  <li>Reperfusion arrhythmias (most commonly accelerated idioventricular rhythm)</li>
  <li>Cardiogenic shock (especially in large anterior STEMI)</li>
  <li>Acute mitral regurgitation from papillary muscle rupture</li>
  <li>Ventricular free wall rupture (peak 3\u20135 days) — cardiac tamponade</li>
  <li>Ventricular septal rupture (peak 3\u20135 days)</li>
</ul>

<h3>Late (&gt; 72 hours)</h3>
<ul>
  <li>Post-infarction pericarditis (Dressler syndrome, 2\u201310 weeks) — autoimmune-mediated</li>
  <li>Ventricular aneurysm — persistent ST elevation, heart failure, thromboembolism</li>
  <li>Heart failure with reduced ejection fraction</li>
</ul>

<h2>Prognosis</h2>
<p>In-hospital mortality for STEMI is approximately 5\u20138% with primary PCI and 7\u201310% with fibrinolytics. Major predictors of mortality include age, Killip class, time to reperfusion, anterior infarct location, and development of cardiogenic shock (which carries &gt; 50% mortality).</p>
`,
  },
  {
    id: "art-acs",
    title: "Acute Coronary Syndromes — Overview",
    specialty: "Cardiology",
    system: "Ischemic Syndrome",
    readTimeMin: 6,
    tags: ["ischemia", "overview"],
    html: `
<h1>Acute Coronary Syndromes (ACS)</h1>
<p><strong>Acute coronary syndromes</strong> represent a spectrum of conditions resulting from acute myocardial ischemia, ranging from unstable angina to ST-elevation myocardial infarction. They share a common underlying pathophysiology: <strong>atherosclerotic plaque rupture or erosion with varying degrees of thrombus formation</strong>.</p>

<h2>Classification</h2>
<table>
  <thead>
    <tr><th>Type</th><th>ST changes</th><th>Troponin</th></tr>
  </thead>
  <tbody>
    <tr><td>Unstable angina (UA)</td><td>None / transient</td><td>Normal</td></tr>
    <tr><td>NSTEMI</td><td>None / transient</td><td>Elevated</td></tr>
    <tr><td>STEMI</td><td>Persistent ST elevation</td><td>Elevated</td></tr>
  </tbody>
</table>

<h2>Pathophysiology</h2>
<p>The central event is <strong>plaque rupture or erosion</strong>, exposing the thrombogenic lipid core to circulating blood.</p>

<h2>Clinical Presentation</h2>
<p>Patients typically present with chest pain that is:</p>
<ul>
  <li>New-onset (\u2264 2 months)</li>
  <li>Acceleration/worsening of stable angina</li>
  <li>At rest and prolonged (&gt; 20 minutes)</li>
</ul>

<h2>Risk Stratification</h2>
<p>The <strong>GRACE score</strong> uses age, heart rate, blood pressure, creatinine, Killip class, ST deviation, cardiac arrest at admission, and elevated biomarkers to estimate 6-month mortality.</p>

<h2>Initial Management</h2>
<p>All ACS patients receive:</p>
<ul>
  <li>Aspirin 162\u2013325 mg chewed</li>
  <li>P2Y12 inhibitor (ticagrelor preferred; clopidogrel if contraindicated)</li>
  <li>Anticoagulation (unfractionated heparin, enoxaparin, or fondaparinux)</li>
  <li>High-intensity statin (atorvastatin 80 mg)</li>
  <li>Beta-blocker (if no acute heart failure, hypotension, or bradycardia)</li>
</ul>

<div class="callout"><strong>STEMI vs NSTEMI distinction matters:</strong> STEMI requires <em>immediate</em> reperfusion (PCI \u2264 90 min, or fibrinolytics \u2264 30 min).</div>
`,
  },
  {
    id: "art-hf",
    title: "Heart Failure — Reduced Ejection Fraction",
    specialty: "Cardiology",
    system: "Heart Failure",
    readTimeMin: 9,
    tags: ["heart-failure", "chronic"],
    html: `
<h1>Heart Failure with Reduced Ejection Fraction (HFrEF)</h1>
<p><strong>HFrEF</strong> is defined by left ventricular ejection fraction (LVEF) \u2264 40% with symptoms or signs of heart failure.</p>

<h2>Etiology</h2>
<ul>
  <li><strong>Coronary artery disease</strong> (50\u201360% of cases)</li>
  <li><strong>Hypertension</strong> — long-standing pressure overload</li>
  <li><strong>Valvular disease</strong> — aortic stenosis, mitral regurgitation</li>
  <li><strong>Dilated cardiomyopathy</strong> — genetic, alcohol, viral, chemotherapy</li>
  <li><strong>Tachycardia-mediated cardiomyopathy</strong></li>
</ul>

<h2>Pathophysiology</h2>
<p>Decreased cardiac output triggers compensatory mechanisms that become maladaptive over time.</p>

<h3>1. Sympathetic Nervous System (SNS)</h3>
<p>Reduced stroke volume activates baroreceptors, increasing norepinephrine release. Chronic SNS activation causes:</p>
<ul>
  <li>Cardiomyocyte apoptosis</li>
  <li>LV hypertrophy and dilation</li>
  <li>Arrhythmias</li>
  <li>Renin release from juxtaglomerular cells</li>
</ul>

<h3>2. Renin-Angiotensin-Aldosterone System (RAAS)</h3>
<p>Renin converts angiotensinogen to angiotensin I, then ACE converts it to angiotensin II.</p>

<div class="callout"><strong>Guideline-directed medical therapy (GDMT)</strong> targets these maladaptive pathways. All four pillars have been shown to reduce mortality in HFrEF.</div>

<h2>Clinical Presentation</h2>
<h3>Left-sided heart failure</h3>
<ul>
  <li>Dyspnea on exertion \u2192 progressing to dyspnea at rest</li>
  <li>Orthopnea (\u2264 2 pillows \u2192 \u2265 3 pillows)</li>
  <li>Paroxysmal nocturnal dyspnea (PND)</li>
  <li>Fatigue, exercise intolerance</li>
</ul>

<h3>Right-sided heart failure</h3>
<ul>
  <li>Peripheral edema (ankles, sacrum)</li>
  <li>Hepatomegaly with RUQ pain</li>
  <li>Jugular venous distension (JVD)</li>
  <li>Ascites, anasarca in severe cases</li>
</ul>

<h2>Diagnosis</h2>
<h3>Echocardiography</h3>
<p>Confirms reduced LVEF (\u2264 40%), assesses chamber sizes, wall motion, valvular function.</p>

<h3>BNP / NT-proBNP</h3>
<p>BNP &gt; 100 pg/mL or NT-proBNP &gt; 300 pg/mL supports diagnosis.</p>

<h2>Management — The Four Pillars of GDMT</h2>

<h3>Pillar 1: Beta-blocker</h3>
<p>Carvedilol, metoprolol succinate, or bisoprolol. Reduces mortality by ~35%.</p>

<h3>Pillar 2: ACEi / ARB / ARNI</h3>
<p><strong>ARNI</strong> (sacubitril/valsartan) is preferred over ACEi/ARB based on PARADIGM-HF.</p>

<h3>Pillar 3: MRA</h3>
<p>Spironolactone or eplerenone. Reduces mortality 30% in NYHA III\u2013IV.</p>

<h3>Pillar 4: SGLT2 inhibitor</h3>
<p>Dapagliflozin or empagliflozin. Reduces HF hospitalization and CV mortality.</p>

<h2>Prognosis</h2>
<p>Five-year mortality for HFrEF remains ~50% despite optimal therapy.</p>
`,
  },
  {
    id: "art-copd",
    title: "Chronic Obstructive Pulmonary Disease",
    specialty: "Pulmonology",
    system: "Obstructive Disease",
    readTimeMin: 10,
    tags: ["obstructive", "chronic", "smoking"],
    html: `
<h1>Chronic Obstructive Pulmonary Disease (COPD)</h1>
<p><strong>COPD</strong> is a common, preventable, and treatable disease characterized by persistent respiratory symptoms and airflow limitation.</p>

<h2>Risk Factors</h2>
<ul>
  <li><strong>Tobacco smoking</strong> (most important; ~80% of COPD deaths)</li>
  <li><strong>Occupational exposure</strong> — dusts, chemicals</li>
  <li><strong>Indoor biomass fuel</strong> — wood/dung smoke</li>
  <li><strong>Alpha-1 antitrypsin deficiency</strong></li>
  <li><strong>Childhood respiratory infections</strong></li>
</ul>

<h2>Pathophysiology</h2>

<h3>Chronic Bronchitis</h3>
<p>Productive cough for \u2265 3 months in 2 consecutive years. Mucus gland hyperplasia increases the <strong>Reid index</strong>.</p>

<h3>Emphysema</h3>
<p>Permanent enlargement of airspaces with alveolar wall destruction. Two patterns:</p>
<ul>
  <li><strong>Centriacinar:</strong> Upper lobes; smoking-related</li>
  <li><strong>Panacinar:</strong> Lower lobes; alpha-1 antitrypsin deficiency</li>
</ul>

<h2>Clinical Presentation</h2>
<table>
  <thead>
    <tr><th>Feature</th><th>Chronic Bronchitis</th><th>Emphysema</th></tr>
  </thead>
  <tbody>
    <tr><td>Age</td><td>~50s</td><td>~60s</td></tr>
    <tr><td>Body habitus</td><td>Obese</td><td>Cachectic</td></tr>
    <tr><td>Sputum</td><td>Copious, purulent</td><td>Scanty, mucoid</td></tr>
    <tr><td>Cyanosis</td><td>Present</td><td>Absent</td></tr>
    <tr><td>Dyspnea</td><td>Mild-moderate</td><td>Severe, progressive</td></tr>
    <tr><td>PaCO\u2082</td><td>Elevated</td><td>Normal or low</td></tr>
  </tbody>
</table>

<div class="callout">Modern teaching: The "blue bloater" vs "pink puffer" dichotomy is an oversimplification. Use the GOLD ABCD assessment tool.</div>

<h2>Diagnosis</h2>
<h3>Spirometry</h3>
<p>Post-bronchodilator <strong>FEV1/FVC &lt; 0.70</strong> confirms airflow limitation.</p>

<table>
  <thead>
    <tr><th>GOLD Stage</th><th>Severity</th><th>FEV1 (% predicted)</th></tr>
  </thead>
  <tbody>
    <tr><td>GOLD 1</td><td>Mild</td><td>\u2265 80%</td></tr>
    <tr><td>GOLD 2</td><td>Moderate</td><td>50\u201379%</td></tr>
    <tr><td>GOLD 3</td><td>Severe</td><td>30\u201349%</td></tr>
    <tr><td>GOLD 4</td><td>Very Severe</td><td>&lt; 30%</td></tr>
  </tbody>
</table>

<h2>Management</h2>
<h3>Non-pharmacologic</h3>
<ul>
  <li><strong>Smoking cessation</strong> — only intervention that slows progression</li>
  <li><strong>Vaccinations</strong> — influenza, pneumococcal, COVID-19</li>
  <li><strong>Pulmonary rehabilitation</strong></li>
  <li><strong>Long-term oxygen therapy (LTOT)</strong> — if PaO\u2082 \u2264 55 mm Hg</li>
</ul>

<div class="warning"><strong>ICS caution:</strong> Inhaled corticosteroids increase pneumonia risk in COPD. Do NOT use ICS alone.</div>

<h2>Acute Exacerbation (AECOPD)</h2>
<p>Defined by increased dyspnea, sputum volume, or purulence (Anthonisen criteria).</p>

<h2>Prognosis</h2>
<p>COPD is the <strong>third leading cause of death</strong> worldwide. Five-year mortality after first hospitalization ~50%.</p>
`,
  },
  {
    id: "art-asthma",
    title: "Asthma — Diagnosis & Management",
    specialty: "Pulmonology",
    system: "Obstructive Disease",
    readTimeMin: 7,
    tags: ["obstructive", "eosinophilic"],
    html: `
<h1>Asthma</h1>
<p><strong>Asthma</strong> is a chronic inflammatory airway disease characterized by reversible airflow obstruction, bronchial hyperresponsiveness, and airway remodeling.</p>

<h2>Pathophysiology</h2>
<p>Primarily a <strong>Type 2 (Th2-mediated) inflammatory disease</strong>. Key mediators:</p>
<ul>
  <li>IL-4 \u2192 IgE class switching</li>
  <li>IL-5 \u2192 eosinophil maturation</li>
  <li>IL-13 \u2192 mucus hypersecretion</li>
</ul>

<h2>Triggers</h2>
<ul>
  <li>Allergens: dust mites, pet dander, pollen, mold</li>
  <li>Respiratory infections</li>
  <li>Exercise (cold, dry air)</li>
  <li>Aspirin / NSAIDs (AERD)</li>
  <li>GERD, stress</li>
</ul>

<h2>Clinical Presentation</h2>
<p>Classic triad: <strong>wheezing, dyspnea, cough</strong> (worse at night/early morning).</p>

<h2>Diagnosis</h2>
<h3>Spirometry</h3>
<ul>
  <li>FEV1/FVC &lt; 0.75 (LLN)</li>
  <li><strong>FEV1 improves \u2265 12% AND \u2265 200 mL</strong> after SABA</li>
</ul>

<h3>Bronchoprovocation</h3>
<p>Methacholine challenge if spirometry is normal but suspicion remains.</p>

<h2>Stepwise Management (GINA 2023)</h2>

<h3>Track 1 (Preferred): AIR</h3>
<ul>
  <li><strong>Steps 1\u20132:</strong> Low-dose ICS-formoterol PRN</li>
  <li><strong>Step 3:</strong> Low-dose ICS-formoterol maintenance + PRN</li>
  <li><strong>Step 4:</strong> Medium-dose ICS-formoterol maintenance + PRN</li>
  <li><strong>Step 5:</strong> High-dose ICS-formoterol + add-on + PRN</li>
</ul>

<div class="warning"><strong>GINA no longer recommends SABA-only treatment</strong> for mild asthma. All patients should receive ICS-containing therapy.</div>

<h3>Biologics (Step 5)</h3>
<ul>
  <li><strong>Omalizumab</strong> (anti-IgE): Allergic asthma</li>
  <li><strong>Mepolizumab, reslizumab</strong> (anti-IL-5): Eosinophilic asthma</li>
  <li><strong>Benralizumab</strong> (anti-IL-5R\u03b1)</li>
  <li><strong>Dupilumab</strong> (anti-IL-4R\u03b1)</li>
  <li><strong>Tezepelumab</strong> (anti-TSLP)</li>
</ul>

<h2>Acute Severe Asthma</h2>
<h3>Management</h3>
<ul>
  <li><strong>Oxygen:</strong> Target SpO\u2082 93\u201395%</li>
  <li><strong>SABA:</strong> Albuterol nebulized</li>
  <li><strong>Ipratropium:</strong> 0.5 mg nebulized</li>
  <li><strong>Corticosteroids:</strong> Prednisone 40\u201350 mg PO</li>
  <li><strong>Magnesium sulfate:</strong> 2 g IV for severe cases</li>
</ul>
`,
  },
  {
    id: "art-pe",
    title: "Pulmonary Embolism",
    specialty: "Pulmonology",
    system: "Vascular Disease",
    readTimeMin: 8,
    tags: ["vascular", "emergency"],
    html: `
<h1>Pulmonary Embolism (PE)</h1>
<p><strong>Pulmonary embolism</strong> is obstruction of the pulmonary arterial tree, most commonly by thrombus from deep veins of the lower extremities (DVT).</p>

<h2>Risk Factors — Virchow's Triad</h2>
<ol>
  <li><strong>Endothelial injury:</strong> Trauma, surgery, IV catheters</li>
  <li><strong>Hypercoagulability:</strong> Malignancy, pregnancy, OCPs, Factor V Leiden, protein C/S deficiency</li>
  <li><strong>Stasis:</strong> Immobility, heart failure, obesity</li>
</ol>

<div class="callout"><strong>Unprovoked VTE</strong> should prompt evaluation for occult malignancy in patients &gt; 40 years.</div>

<h2>Clinical Presentation</h2>
<ul>
  <li><strong>Small PE:</strong> Pleuritic chest pain, dyspnea, hemoptysis</li>
  <li><strong>Large PE:</strong> Significant dyspnea, hypoxia, tachycardia</li>
  <li><strong>Massive PE:</strong> Syncope, hypotension, cardiac arrest</li>
</ul>

<h2>Diagnostic Approach</h2>

<h3>Wells Score</h3>
<table>
  <thead><tr><th>Wells Score</th><th>Probability</th></tr></thead>
  <tbody>
    <tr><td>&lt; 2</td><td>Low (PE unlikely)</td></tr>
    <tr><td>2\u20136</td><td>Moderate</td></tr>
    <tr><td>&gt; 6</td><td>High (PE likely)</td></tr>
  </tbody>
</table>

<h3>D-dimer</h3>
<p>High sensitivity, low specificity. Useful to <strong>rule out</strong> in low-probability patients.</p>

<h3>CT Pulmonary Angiography (CTPA)</h3>
<p>Gold standard. Sensitivity ~95%, specificity ~95%.</p>

<h2>Risk Stratification</h2>
<ul>
  <li><strong>Massive (high-risk) PE:</strong> Hypotension or shock</li>
  <li><strong>Submassive (intermediate-risk) PE:</strong> Normotensive with RV strain</li>
  <li><strong>Low-risk PE:</strong> Normotensive without RV strain</li>
</ul>

<h2>Management</h2>

<h3>Anticoagulation</h3>
<ul>
  <li><strong>DOACs</strong> (preferred): Apixaban or rivaroxaban</li>
  <li><strong>LMWH</strong> (enoxaparin): Pregnancy, cancer</li>
  <li><strong>Warfarin:</strong> Requires INR overlap</li>
</ul>

<h3>Massive PE</h3>
<ul>
  <li><strong>Systemic thrombolysis:</strong> Alteplase 100 mg IV</li>
  <li><strong>Catheter-directed thrombolysis</strong></li>
  <li><strong>Surgical embolectomy</strong></li>
  <li><strong>VA ECMO</strong></li>
</ul>

<h2>Prognosis</h2>
<p>Three-month mortality: ~10% overall; ~30\u201360% for massive PE.</p>
`,
  },
  {
    id: "art-stroke",
    title: "Acute Ischemic Stroke",
    specialty: "Neurology",
    system: "Cerebrovascular",
    readTimeMin: 9,
    tags: ["emergency", "cerebrovascular"],
    html: `
<h1>Acute Ischemic Stroke</h1>
<p><strong>Acute ischemic stroke</strong> accounts for ~87% of all strokes. Every minute of delay = ~1.9 million neurons lost.</p>

<h2>Etiology — TOAST Classification</h2>
<ol>
  <li><strong>Large-artery atherosclerosis</strong> (~20%)</li>
  <li><strong>Cardioembolism</strong> (~20%): Atrial fibrillation most common</li>
  <li><strong>Small-vessel occlusion (lacunar)</strong> (~25%)</li>
  <li><strong>Other determined cause</strong> (~5%)</li>
  <li><strong>Undetermined (cryptogenic)</strong> (~30%)</li>
</ol>

<h2>Risk Factors</h2>
<p>Modifiable: hypertension (most important), AF, diabetes, smoking. Non-modifiable: age, sex, ethnicity, family history.</p>

<h2>Clinical Presentation</h2>

<h3>Middle Cerebral Artery (MCA)</h3>
<ul>
  <li>Contralateral hemiparesis (face & arm &gt; leg)</li>
  <li>Hemisensory loss</li>
  <li>Homonymous hemianopia</li>
  <li><strong>Dominant (left) MCA:</strong> Aphasia</li>
  <li><strong>Non-dominant (right) MCA:</strong> Hemineglect</li>
</ul>

<h3>Posterior Cerebral Artery (PCA)</h3>
<ul>
  <li>Contralateral homonymous hemianopia (macular sparing)</li>
  <li>Alexia without agraphia</li>
</ul>

<h2>Diagnosis</h2>
<h3>Non-contrast Head CT</h3>
<p><strong>First test — exclude hemorrhage.</strong></p>

<h3>CT Angiography (CTA)</h3>
<p>Identifies large vessel occlusion (LVO) for thrombectomy.</p>

<h2>Acute Management</h2>

<h3>Intravenous Thrombolysis (tPA)</h3>
<p><strong>Alteplase</strong> 0.9 mg/kg (max 90 mg):</p>
<ul>
  <li>Standard window: Within 3 hours</li>
  <li>Extended window: Within 4.5 hours (selected patients)</li>
</ul>

<div class="warning"><strong>Tenecteplase (TNK)</strong> (0.25 mg/kg single IV bolus) is now preferred over alteplase at many centers.</div>

<h3>Mechanical Thrombectomy</h3>
<p>For <strong>large vessel occlusion (LVO)</strong> in anterior circulation within 6\u201324 hours with favorable perfusion imaging.</p>

<h2>Prognosis</h2>
<p>30-day mortality: ~15% for ischemic stroke. 5-year recurrence risk: ~25%.</p>
`,
  },
  {
    id: "art-sah",
    title: "Subarachnoid Hemorrhage",
    specialty: "Neurology",
    system: "Cerebrovascular",
    readTimeMin: 7,
    tags: ["emergency", "vascular"],
    html: `
<h1>Subarachnoid Hemorrhage (SAH)</h1>
<p><strong>Subarachnoid hemorrhage</strong> is bleeding into the subarachnoid space. Classic presentation: sudden-onset severe headache ("thunderclap").</p>

<h2>Etiology</h2>
<ul>
  <li><strong>Ruptured saccular (berry) aneurysm</strong> (~85%)</li>
  <li>Perimesencephalic nonaneurysmal SAH (~10%)</li>
  <li>AVM, vasculitis, trauma</li>
</ul>

<h3>Risk Factors</h3>
<ul>
  <li>Hypertension, smoking</li>
  <li>Family history, ADPKD</li>
  <li>Ehlers-Danlos, Marfan</li>
  <li>Age 40\u201360; female &gt; male</li>
</ul>

<h2>Clinical Presentation</h2>
<p>Hallmark: <strong>"thunderclap headache"</strong> — maximal intensity within seconds.</p>
<ul>
  <li>Nausea, vomiting, photophobia</li>
  <li>Neck stiffness (meningismus)</li>
  <li>Transient loss of consciousness</li>
  <li>Seizures</li>
</ul>

<h2>Diagnosis</h2>
<h3>Non-contrast Head CT</h3>
<p>Sensitivity ~98% within 6 hours.</p>

<h3>Lumbar Puncture</h3>
<p>If CT negative but suspicion remains. Look for <strong>xanthochromia</strong>.</p>

<h2>Management</h2>

<h3>Initial Stabilization</h3>
<ul>
  <li>ABCs, BP control (SBP &lt; 160)</li>
  <li>Seizure prophylaxis: Levetiracetam</li>
</ul>

<h3>Definitive Treatment</h3>
<ul>
  <li><strong>Endovascular coiling</strong> (preferred for posterior circulation)</li>
  <li><strong>Surgical clipping</strong> (wide-neck, MCA, young patients)</li>
</ul>

<h3>Complications</h3>
<h4>Vasospasm and DCI</h4>
<p>Peak days 4\u201314. <strong>Nimodipine 60 mg PO q4h \u00d7 21 days</strong> reduces poor outcomes.</p>

<h2>Hunt & Hess Grading</h2>
<table>
  <thead><tr><th>Grade</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Asymptomatic, mild headache</td></tr>
    <tr><td>2</td><td>Moderate-severe headache, nuchal rigidity</td></tr>
    <tr><td>3</td><td>Drowsy, minimal deficit</td></tr>
    <tr><td>4</td><td>Stupor, moderate-severe hemiparesis</td></tr>
    <tr><td>5</td><td>Deep coma, decerebrate posturing</td></tr>
  </tbody>
</table>

<h2>Prognosis</h2>
<p>Overall mortality ~30%. Among survivors, ~30% have moderate-severe disability.</p>
`,
  },
  {
    id: "art-cirrhosis",
    title: "Cirrhosis & Portal Hypertension",
    specialty: "Gastroenterology",
    system: "Hepatobiliary",
    readTimeMin: 9,
    tags: ["liver", "chronic"],
    html: `
<h1>Cirrhosis and Portal Hypertension</h1>
<p><strong>Cirrhosis</strong> is the end-stage of chronic liver disease, characterized by fibrosis and regenerative nodules. It is <strong>irreversible</strong> but progression can be slowed.</p>

<h2>Etiology</h2>
<ul>
  <li><strong>Alcohol-related liver disease</strong> (most common in West)</li>
  <li><strong>NAFLD/NASH</strong> — increasingly common</li>
  <li><strong>Chronic viral hepatitis</strong> — HBV, HCV</li>
  <li><strong>Autoimmune hepatitis</strong></li>
  <li><strong>PBC, PSC</strong></li>
  <li><strong>Hemochromatosis, Wilson disease</strong></li>
  <li><strong>Alpha-1 antitrypsin deficiency</strong></li>
</ul>

<h2>Portal Hypertension</h2>
<p>Defined as <strong>HVPG &gt; 5 mm Hg</strong>. Clinically significant at &gt; 10 mm Hg.</p>

<h2>Clinical Manifestations</h2>

<h3>Stigmata of Chronic Liver Disease</h3>
<ul>
  <li>Palmar erythema, spider angiomata</li>
  <li>Jaundice, gynecomastia</li>
  <li>Caput medusae, asterixis</li>
  <li>Fetor hepaticus, clubbing</li>
</ul>

<h3>Complications</h3>

<h4>1. Varices</h4>
<p>Portosystemic collaterals: esophageal (most significant), gastric, rectal.</p>
<p><strong>Variceal bleeding:</strong> 30% 6-week mortality. Treatment: octreotide, band ligation, antibiotics (ceftriaxone), TIPS if refractory.</p>

<h4>2. Ascites</h4>
<p><strong>SAAG \u2265 1.1 g/dL</strong> confirms portal hypertension. Treatment: sodium restriction, spironolactone + furosemide.</p>

<h4>3. Spontaneous Bacterial Peritonitis (SBP)</h4>
<p>Diagnostic: ascitic PMN \u2265 250 cells/mm\u00b3. Treatment: cefotaxime 2 g IV.</p>

<h4>4. Hepatic Encephalopathy (HE)</h4>
<p>Ammonia accumulation. Treatment: lactulose, rifaximin.</p>

<h4>5. Hepatorenal Syndrome (HRS)</h4>
<p>Functional renal failure. Type 1: 80% mortality at 2 weeks. Treatment: octreotide + midodrine + albumin, liver transplant definitive.</p>

<h2>Child-Pugh Score</h2>
<table>
  <thead><tr><th>Score</th><th>Class</th><th>1-year survival</th></tr></thead>
  <tbody>
    <tr><td>5\u20136</td><td>A</td><td>100%</td></tr>
    <tr><td>7\u20139</td><td>B</td><td>80%</td></tr>
    <tr><td>10\u201315</td><td>C</td><td>45%</td></tr>
  </tbody>
</table>

<h2>Prognosis</h2>
<p>Compensated cirrhosis: median survival &gt; 12 years. Decompensated: ~1.5\u20132 years without transplant.</p>
`,
  },
];

// --- Conversion setup ---
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  bulletListMarker: "-",
  hr: "---",
});

turndown.addRule("callout", {
  filter: (node) => node.nodeName === "DIV" && node.classList?.contains("callout"),
  replacement: (content) => {
    const inner = content.trim().replace(/\n{2,}/g, "\n> ");
    return `\n\n> ${inner}\n`;
  },
});
turndown.addRule("warning", {
  filter: (node) => node.nodeName === "DIV" && node.classList?.contains("warning"),
  replacement: (content) => {
    // Content already has strong/caution text, just wrap in blockquote
    const inner = content.trim().replace(/\n{2,}/g, "\n> ");
    return `\n\n> ${inner}\n`;
  },
});

function htmlTableToMarkdown(tableHtml) {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const rows = [];
  let match;
  while ((match = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = match[1];
    const cells = [];
    let cm;
    while ((cm = cellRegex.exec(rowHtml)) !== null) {
      let cellText = cm[1]
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/&mdash;/g, "\u2014")
        .replace(/&ndash;/g, "\u2013")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(cellText);
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const lines = [];
  const isHeader = /<th/i.test(tableHtml.split("</tr>")[0]);
  lines.push("| " + rows[0].join(" | ") + " |");
  lines.push("| " + rows[0].map(() => "---").join(" | ") + " |");
  for (let i = 1; i < rows.length; i++) {
    while (rows[i].length < cols) rows[i].push("");
    lines.push("| " + rows[i].join(" | ") + " |");
  }
  return "\n\n" + lines.join("\n") + "\n";
}

const outDir = path.join(__dirname, "..", "public", "osler-content", "library");

for (const art of articles) {
  let html = art.html.trim();

  // Pre-extract tables
  const tableMap = [];
  let tidx = 0;
  html = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (m) => {
    const md = htmlTableToMarkdown(m);
    const marker = `ZZTBL${tidx}ZZ`;
    tableMap.push({ marker, md });
    tidx++;
    return marker;
  });

  let markdown = turndown.turndown(html);

  for (const { marker, md } of tableMap) {
    markdown = markdown.replace(marker, md);
  }

  markdown = markdown.replace(/\n{3,}/g, "\n\n");

  // Build frontmatter
  const tags = art.tags.map((t) => `  - ${t}`).join("\n");
  const frontmatter = `---
id: ${art.id}
title: ${art.title}
specialty: ${art.specialty}
system: ${art.system}
readTimeMin: ${art.readTimeMin}
tags:
${tags}
---`;

  const fp = path.join(outDir, `${art.id}.md`);
  fs.writeFileSync(fp, frontmatter + "\n\n" + markdown.trim() + "\n");
  console.log(`Wrote ${art.id}.md`);
}

console.log("Done!");
