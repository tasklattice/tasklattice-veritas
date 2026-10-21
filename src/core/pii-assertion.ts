import {piiGrade} from './grading.js';
import type {Case} from '../shared/types.js';
export default (output:string,context:{vars:{case:Case}}) => piiGrade(output,context.vars.case);
