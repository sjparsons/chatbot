/**
 * Chat transport. Mocked for now — this is the seam where the real
 * Chat API Service call will go.
 */
export async function sendMessage(_content: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return "RESPONSE";
}
