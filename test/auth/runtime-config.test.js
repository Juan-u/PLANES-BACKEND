import{test}from'node:test';import assert from'node:assert/strict';import{runtimePort}from'../../app/config/runtime.js';
test('isolated backend port is validated without changing default configuration',()=>{assert.equal(runtimePort('3010'),3010);assert.equal(runtimePort('3000'),3000);for(const value of ['0','65536','3010x',''])assert.throws(()=>runtimePort(value));});
