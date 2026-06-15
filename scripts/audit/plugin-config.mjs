// Plugin config-validation + error-handling probe: each validator must accept a
// valid config and REJECT an invalid one (throw). Verifies defensive input handling.
import { validateOpenAiConfig } from '@streetjs/plugin-openai';
import { validateS3Config } from '@streetjs/plugin-s3';

function check(name, fn, valid, invalid) {
  let acceptOk = false, rejectOk = false;
  try { fn(valid); acceptOk = true; } catch (e) { acceptOk = false; }
  try { fn(invalid); rejectOk = false; } catch { rejectOk = true; }
  console.log(`${name}: accepts-valid=${acceptOk ? 'OK' : 'FAIL'} rejects-invalid=${rejectOk ? 'OK' : 'FAIL'}`);
  return acceptOk && rejectOk;
}

let pass = true;
pass = check('plugin-openai', validateOpenAiConfig,
  { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
  { apiKey: 123 }) && pass;

pass = check('plugin-s3', validateS3Config,
  { region: 'us-east-1', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'sk' },
  { region: 42 }) && pass;

console.log(pass ? 'RESULT: config validation OK' : 'RESULT: config validation FAIL');
process.exit(pass ? 0 : 1);
