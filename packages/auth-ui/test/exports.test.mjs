import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../dist/index.js';

test('@streetjs/auth-ui exports', async (t) => {
  await t.test('exposes all auth components', () => {
    for (const name of ['LoginForm', 'RegisterForm', 'ForgotPasswordForm', 'MFASetup', 'ProfileSettings']) {
      assert.equal(typeof ui[name], 'function', `missing component ${name}`);
    }
  });

  await t.test('exposes theming primitives', () => {
    for (const name of ['StreetAuthStyles', 'Field', 'Button', 'ErrorText']) {
      assert.equal(typeof ui[name], 'function', `missing primitive ${name}`);
    }
    assert.equal(typeof ui.streetAuthCss, 'string');
    assert.ok(ui.streetAuthCss.includes('--st-accent'), 'css exposes theme variables');
    assert.ok(ui.streetAuthCss.includes('prefers-color-scheme: dark'), 'css supports dark mode');
  });

  await t.test('ErrorText renders null when no error, alert element when present', () => {
    assert.equal(ui.ErrorText({}), null);
    const node = ui.ErrorText({ error: new Error('boom') });
    assert.equal(node.props.role, 'alert');
    assert.equal(node.props.children, 'boom');
  });
});
