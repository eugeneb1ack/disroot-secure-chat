// Audited integration boundary for the pinned ts-mls 1.6.4 API.
// Keep these constraints even if the dependency changes its retention defaults.
import { unprotectPrivateMessage } from "ts-mls/messageProtection.js";
import type { ClientState, CiphersuiteImpl, PrivateMessage } from "ts-mls";

export function currentEpochState(state: ClientState): ClientState {
  const { clientConfig, historicalReceiverData: discarded, ...current } = state;
  void discarded;
  // ts-mls 1.6.4 uses slice(-0) for retainKeysForEpochs=0. Never copy that history.
  // Callers wipe the source state after installing this independent current-state copy.
  return { ...structuredClone(current), historicalReceiverData: new Map(), clientConfig };
}
export async function authenticatedApplication(state: ClientState, message: PrivateMessage, suite: CiphersuiteImpl) {
  if (message.contentType !== "application" || message.epoch !== state.groupContext.epoch) throw new Error("Unexpected MLS application epoch.");
  const result = await unprotectPrivateMessage(state.keySchedule.senderDataSecret, message, state.secretTree, state.ratchetTree, state.groupContext, state.clientConfig.keyRetentionConfig, suite);
  const content = result.content.content;
  if (content.contentType !== "application" || content.sender.senderType !== "member") throw new Error("Invalid authenticated MLS sender.");
  const leaf = state.ratchetTree[content.sender.leafIndex * 2];
  if (leaf?.nodeType !== "leaf") throw new Error("MLS sender is absent from the group.");
  return { message: content.applicationData, senderKey: leaf.leaf.signaturePublicKey,
    newState: { ...state, secretTree: result.tree }, consumed: result.consumed };
}
