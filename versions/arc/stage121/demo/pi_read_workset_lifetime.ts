/** Mechanical release boundary, not a claim that evidence was understood. */
export function readWorksetConsumer(message: any): boolean {
    if (message?.role === "toolResult") return !message.isError
        && ["arc_action", "arc_actions"].includes(message.toolName)
        && message.details?.arc_action_boundary === true
        && (message.toolName !== "arc_actions"
            || (Array.isArray(message.details.completed) && message.details.completed.length > 0));
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return false;
    if (["length", "error", "aborted"].includes(message.stopReason)) return false;
    // Tool-only gathering and native reasoning are intermediate work. Preserve
    // the whole read batch until a response or a successful environment action.
    return !message.content.some((part: any) => part?.type === "toolCall")
        && message.content.some((part: any) => part?.type === "text" && String(part.text ?? "").trim());
}
