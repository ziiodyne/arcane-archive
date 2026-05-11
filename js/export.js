function exportSessionMarkdown(session){
  const chars = (session.characters || [])
    .filter(x => x.approved !== false)
    .map(x => x.name);

  const locs = (session.locations || [])
    .filter(x => x.approved !== false)
    .map(x => x.name);

  const threads = (session.threads || []).map(x => x.text || String(x));
  const timeline = (session.timeline || []).map(e => {
    const prefix = e.time ? `${e.time} · ` : "";
    return `${prefix}${e.text || ""}`;
  });

  const md = `# ${session.title || "Session"}

**Date:** ${session.date || ""}

## Summary
${session.summary || ""}

## Characters
${chars.map(x => `- ${x}`).join("\n") || "- (none)"}

## Locations
${locs.map(x => `- ${x}`).join("\n") || "- (none)"}

## Open Threads
${threads.map(x => `- ${x}`).join("\n") || "- (none)"}

## Timeline
${timeline.map(x => `- ${x}`).join("\n") || "- (none)"}
`;

  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "arcane-archive-session.md";
  a.click();
  URL.revokeObjectURL(url);
}