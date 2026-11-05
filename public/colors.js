const FALLBACK_COLORS = [
    'var(--alt-background-color)',
    'var(--font-muted-color)',
    'var(--added-text-color)',
    'var(--removed-text-color)',
];

export function candidateColor(choice, index, contestType, choices) {
    if (contestType === 'BallotMeasure') {
        const name = choice.name?.trim().toLowerCase();
        if (name === 'yes') return '#2e8b57';
        if (name === 'no') return '#7e57c2';
        return index === 0 ? '#2e8b57' : '#7e57c2';
    }
    if (choices.length > 1 && choices.every(candidate => candidate.party === 'DEM')) {
        return index === 0 ? '#e3b505' : '#e76f00';
    }
    if (choices.length > 1 && choices.every(candidate => !candidate.party)) {
        return ['#e3b505', '#e76f00', '#2e8b57'][index % 3];
    }
    if (choice.color) return choice.color;
    const party = String(choice.party || '').trim().toUpperCase();
    if (['DEM', 'DEMOCRAT', 'DEMOCRATIC'].includes(party)) return '#2563eb';
    if (['REP', 'REPUBLICAN'].includes(party)) return '#dc2626';
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}
