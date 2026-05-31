// Sends via an HTTP email API. EMAIL_API_KEY/EMAIL_FROM are secrets.
// If no key configured (local dev), logs the link so testing still works.
export async function sendMagicLink(env, email, link) {
  if (!env.EMAIL_API_KEY) {
    console.log(`[dev] magic link for ${email}: ${link}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.EMAIL_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email,
      subject: "Your Brain Notes sign-in link",
      html: `<p>Click to sign in:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`,
    }),
  });
  // Surface delivery failures instead of returning a false success to the user.
  if (!res.ok) throw new Error(`email send failed: ${res.status}`);
}
