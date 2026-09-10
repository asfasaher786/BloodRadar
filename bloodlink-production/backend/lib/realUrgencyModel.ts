import { TextClassifier } from "./mlEngine";
import { getEmergencies } from "../services/dbService";

// Minimum number of real, labeled examples before we trust the model enough
// to show predictions. Below this, we say so honestly instead of pretending
// a model trained on 3 examples means anything.
const MIN_REAL_EXAMPLES = 15;
const MIN_CLASSES = 2;

export interface RealModelStatus {
  totalRealRequests: number;
  labeledExamples: number;
  isTrained: boolean;
  classes: string[];
  minRequired: number;
}

// Retrains fresh from whatever real data exists right now. Cheap at this
// scale (dozens/hundreds of records), and guarantees the model always
// reflects the actual current database, not a stale snapshot.
async function buildModelFromRealData(): Promise<{ classifier: TextClassifier | null; status: RealModelStatus }> {
  const emergencies = await getEmergencies();
  const labeled = emergencies.filter((e: any) => e.reason && e.urgency);

  const classCounts = new Map<string, number>();
  for (const e of labeled) {
    classCounts.set(e.urgency, (classCounts.get(e.urgency) || 0) + 1);
  }
  const classes = Array.from(classCounts.keys());

  const status: RealModelStatus = {
    totalRealRequests: emergencies.length,
    labeledExamples: labeled.length,
    isTrained: labeled.length >= MIN_REAL_EXAMPLES && classes.length >= MIN_CLASSES,
    classes,
    minRequired: MIN_REAL_EXAMPLES
  };

  if (!status.isTrained) {
    return { classifier: null, status };
  }

  const classifier = new TextClassifier();
  classifier.train(labeled.map((e: any) => e.reason), labeled.map((e: any) => e.urgency));
  return { classifier, status };
}

export async function getRealModelStatus(): Promise<RealModelStatus> {
  const { status } = await buildModelFromRealData();
  return status;
}

export async function classifyWithRealModel(text: string): Promise<
  | { trained: true; predictedClass: string; confidence: number; scores: { [key: string]: number } }
  | { trained: false; status: RealModelStatus }
> {
  const { classifier, status } = await buildModelFromRealData();
  if (!classifier) {
    return { trained: false, status };
  }
  const prediction = classifier.predict(text);
  return { trained: true, predictedClass: prediction.label, confidence: prediction.confidence, scores: prediction.scores };
}
