import {actionGrade} from './grading.js';
import type {Case} from '../shared/types.js';
import type {ScorerConfig} from '../shared/scorer.js';
export default (output:string,context:{vars:{case:Case;scorer:ScorerConfig}}) => actionGrade(JSON.parse(output),context.vars.case,context.vars.scorer);
