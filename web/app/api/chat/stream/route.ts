export const runtime = "edge";

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const msg = "I'm your AI agent — ready to help! This is a demo response. Connect your OpenClaw VPS to enable real conversations.";
      const words = msg.split(" ");
      let i = 0;
      const interval = setInterval(() => {
        if (i < words.length) {
          const chunk = `event: delta\ndata: ${JSON.stringify({ text: words[i] + " " })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
          i++;
        } else {
          controller.close();
          clearInterval(interval);
        }
      }, 50);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
