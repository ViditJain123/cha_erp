import { describe, expect, it } from 'vitest';
import { GRAPH_SCOPES, missingScopes } from '../src/oauth.js';

describe('missingScopes', () => {
  it('reports nothing when every scope was granted', () => {
    expect(missingScopes([...GRAPH_SCOPES])).toEqual([]);
  });

  it('spots a mailbox connected before sending was requested', () => {
    // Exactly the state every existing connection is in.
    expect(missingScopes(['offline_access', 'Mail.Read', 'User.Read'])).toEqual(['Mail.Send']);
  });

  it('ignores case, since Microsoft echoes scopes back inconsistently', () => {
    expect(missingScopes(['offline_access', 'mail.read', 'mail.send', 'user.read'])).toEqual([]);
  });

  it('ignores the full URI form Graph sometimes returns', () => {
    // Graph may echo "https://graph.microsoft.com/Mail.Read"; treat the short
    // name as authoritative and do not claim a scope is missing when it is not.
    const granted = GRAPH_SCOPES.map((s) =>
      s === 'offline_access' ? s : `https://graph.microsoft.com/${s}`,
    );
    expect(missingScopes(granted)).toEqual([]);
  });

  it('does not demand offline_access, which is never echoed as a resource scope', () => {
    expect(missingScopes(['Mail.Read', 'Mail.Send', 'User.Read'])).toEqual([]);
  });

  it('reports everything for a connection with no grant at all', () => {
    expect(missingScopes([])).toEqual(['Mail.Read', 'Mail.Send', 'User.Read']);
  });
});
