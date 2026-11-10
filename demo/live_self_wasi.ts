/** Typed calls to the repository's bounded CPython/WASI executor. */
import { TASK_PYTHON_FORMAT, type ValidatedTaskPythonProgram } from './pi_task_python.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';
import { validateTaskPureExpressionProgram } from './pi_task_pure_authoring.ts';

const bounds = { input_bytes: 16 * 1024, output_bytes: 8 * 1024, timeout_ms: 4_000 };
const pool = new TaskPythonPool();

export function validateLiveSelfSource(source: string): ValidatedTaskPythonProgram {
    const program = validateTaskPureExpressionProgram({ format: TASK_PYTHON_FORMAT, source }, bounds);
    if (program.format !== TASK_PYTHON_FORMAT) throw new Error('Self method must be Python');
    return program;
}

export function runLiveSelfMethod(source: string, input: Record<string, unknown>, signal?: AbortSignal) {
    return pool.evaluate(validateLiveSelfSource(source), input, signal);
}

export function closeLiveSelfMethods() {
    pool.close();
}
