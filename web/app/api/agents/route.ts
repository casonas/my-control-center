import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    agents: [
      { id: "home-agent", name: "Home Assistant", emoji: "🏠" },
      { id: "school-agent", name: "Study Buddy", emoji: "🎓" },
      { id: "jobs-agent", name: "Job Scout", emoji: "💼" },
      { id: "skills-agent", name: "Skill Coach", emoji: "🧠" },
      { id: "sports-agent", name: "Sports Analyst", emoji: "🏀" },
      { id: "stocks-agent", name: "Market Watch", emoji: "📈" },
      { id: "research-agent", name: "Research AI", emoji: "🔬" },
    ],
  });
}
