export const runtime = "edge";

/**
 * POST /api/jobs/outreach — Proxy outreach generation to external jobs API.
 * Body: { job_title, company, template_type, your_name }
 */
export async function POST(req: Request) {
  const baseUrl = process.env.JOBS_API_URL || "https://jobs-api.my-control-center.com";
  let parsedBody: {
    job_title?: string;
    company?: string;
    template_type?: string;
    your_name?: string;
  } | null = null;

  try {
    const body = await req.json() as {
      job_title?: string;
      company?: string;
      template_type?: string;
      your_name?: string;
    };
    parsedBody = body;
    const jobTitle = (body.job_title || "the role").trim();
    const company = (body.company || "your company").trim();
    const yourName = (body.your_name || "Your Name").trim();
    const templateType = (body.template_type || "cold_email").trim();

    const res = await fetch(`${baseUrl}/jobs/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "MCC-Jobs/1.0", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // Fallback template: keep UX functional even when upstream is unavailable.
      return Response.json(buildFallbackTemplate(templateType, { jobTitle, company, yourName }));
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    // Fallback template: keep UX functional even when upstream is unavailable.
    if (parsedBody) {
      return Response.json(
        buildFallbackTemplate((parsedBody.template_type || "cold_email").trim(), {
          jobTitle: (parsedBody.job_title || "the role").trim(),
          company: (parsedBody.company || "your company").trim(),
          yourName: (parsedBody.your_name || "Your Name").trim(),
        }),
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}

function buildFallbackTemplate(
  templateType: string,
  input: { jobTitle: string; company: string; yourName: string },
) {
  const key = templateType.toLowerCase();
  if (key === "linkedin_connect") {
    return {
      ok: true,
      source: "fallback",
      subject: `Connecting re: ${input.company}`,
      body_md: `Hi, I’m ${input.yourName}. I’m interested in ${input.company}'s ${input.jobTitle} work and would love to connect.\n\nIf you’re open, I’d appreciate a quick conversation about your team and what you look for in candidates.\n\nThanks!`,
    };
  }
  if (key === "follow_up") {
    return {
      ok: true,
      source: "fallback",
      subject: `Following up on ${input.jobTitle}`,
      body_md: `Hi ${input.company} team,\n\nI wanted to follow up on my interest in the ${input.jobTitle} position.\n\nI’m especially interested in contributing to your cybersecurity initiatives and would be glad to share additional details about my background.\n\nBest,\n${input.yourName}`,
    };
  }
  if (key === "thank_you") {
    return {
      ok: true,
      source: "fallback",
      subject: `Thank you - ${input.jobTitle}`,
      body_md: `Thank you for your time discussing the ${input.jobTitle} role.\n\nI enjoyed learning more about ${input.company} and I’m excited about the opportunity to contribute.\n\nBest regards,\n${input.yourName}`,
    };
  }
  return {
    ok: true,
    source: "fallback",
    subject: `Interest in ${input.jobTitle} at ${input.company}`,
    body_md: `Hi ${input.company} team,\n\nI’m reaching out to express interest in the ${input.jobTitle} role.\n\nMy background aligns well with practical cybersecurity work (detection, response, and secure systems), and I’d value the chance to discuss where I could contribute quickly.\n\nBest,\n${input.yourName}`,
  };
}
