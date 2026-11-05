import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateColor } from '../public/colors.js';

test('partisan races use blue for Democrats and red for Republicans independent of candidate order', () => {
    const choices = [{ name: 'Democrat', party: 'DEM' }, { name: 'Republican', party: 'REP' }];
    assert.equal(candidateColor(choices[0], 0, 'Candidate', choices), '#2563eb');
    assert.equal(candidateColor(choices[1], 1, 'Candidate', choices), '#dc2626');
    assert.equal(candidateColor(choices[1], 0, 'Candidate', choices.toReversed()), '#dc2626');
    assert.equal(candidateColor({ ...choices[0], color: '#123456' }, 0, 'Candidate', choices), '#123456');
});

test('same-party races, nonpartisan races, and measures retain distinct colors', () => {
    for (const [type, choices] of [['Candidate', [{ party: 'DEM' }, { party: 'DEM' }]], ['Candidate', [{}, {}]], ['BallotMeasure', [{}, {}]]]) {
        assert.notEqual(candidateColor(choices[0], 0, type, choices), candidateColor(choices[1], 1, type, choices));
    }
});


test('Yes is always green and No is always purple regardless of the source choice order', () => {
    const choices = [{ name: 'NO' }, { name: 'YES' }];
    assert.equal(candidateColor(choices[0], 0, 'BallotMeasure', choices), '#7e57c2');
    assert.equal(candidateColor(choices[1], 1, 'BallotMeasure', choices), '#2e8b57');
    assert.equal(candidateColor({ name: ' Yes ' }, 0, 'BallotMeasure', choices.toReversed()), '#2e8b57');
});
