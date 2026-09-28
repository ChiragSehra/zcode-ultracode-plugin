// Plain assert tests for examples/toy/calculator.js. Run from repo root: node examples/toy/run_tests.js
const assert = require('node:assert');
const calculator = require('./calculator.js');

// Exact-value cases only — integers and terminating decimals, no float ambiguity.
assert.strictEqual(calculator.add(2, 3), 5);
assert.strictEqual(calculator.add(-2, 5), 3);
assert.strictEqual(calculator.subtract(10, 4), 6);
assert.strictEqual(calculator.subtract(0, 7), -7);
assert.strictEqual(calculator.multiply(6, 7), 42);
assert.strictEqual(calculator.multiply(-3, 9), -27);
assert.strictEqual(calculator.divide(10, 4), 2.5);
assert.strictEqual(calculator.divide(0, 5), 0);
assert.throws(() => calculator.divide(1, 0), /divide by zero/i);

console.log('all tests passed');
