export function formatUpdated(updated, timeZone = 'UTC') {
    if (!updated) return 'Snapshot date not provided';
    const date = new Date(updated);
    const label = date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone });
    const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
        .formatToParts(date).find(part => part.type === 'timeZoneName').value;
    return `Updated at ${label} ${zone}`;
}
