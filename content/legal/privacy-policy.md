%% Privacy Policy template. Review every section for your real setup before launch.
%% Sections wrapped in {{#if …}} appear automatically when the matching service is enabled.

_Last updated: {{lastUpdated}}_

This Privacy Policy explains what personal information {{siteName}} ("we", "us") collects when you visit {{siteUrl}}, why we collect it, and the choices you have. We have tried to keep it short and in plain language.

## Who is responsible for your information

This website is operated by {{operatorName}}. If you have any questions about this policy or your personal information, contact us {{contactLine}}.

## Information you give us

- **Contact form.** When you send us a message we receive your name, email address and whatever you write. We use it only to read and reply to your message.
{{#if newsletter}}
- **Newsletter.** If you subscribe, we store your email address, the date you subscribed and confirmed, and the wording of the consent you gave. We use double opt-in: you are only added after you click the confirmation link we email you. Every email contains an unsubscribe link.
{{/if}}

## Information collected automatically

- **Server logs.** Like most websites, our hosting provider records technical information such as your IP address, browser type, the page requested and the time of the request. These logs are used to keep the site secure and working.
- **Abuse prevention.** To limit spam and brute-force attacks, our forms count recent submissions. We do not store raw IP addresses for this; we keep a one-way pseudonymous code for a short time.
- **Cookies and similar technologies.** See our [Cookie Policy](/cookie-policy) for the full list and how to change your choices.

{{#if analytics}}
## Analytics

{{#if ga4}}
With your consent, we use **Google Analytics 4**, provided by Google, to understand how visitors use the site (for example which articles are read most). Google Analytics uses cookies and collects information such as pages visited, approximate location derived from your IP address, device and browser details. Google acts as our service provider. Learn more in [how Google uses information from sites that use its services](https://policies.google.com/technologies/partner-sites).
{{/if}}
{{#if plausible}}
We use **Plausible Analytics** to count visits and see which pages are popular. Plausible is designed not to use cookies or collect personal data such as full IP addresses.
{{/if}}
{{/if}}

{{#if ads}}
## Advertising

This website shows ads served by **Google AdSense**. Advertising helps cover the cost of running the site; it does not influence what we write.

- Third-party vendors, including Google, use cookies to serve ads based on your previous visits to this website or other websites.
- Google's use of advertising cookies enables it and its partners to serve ads to you based on your visits to this site and/or other sites on the internet.
- You may opt out of personalised advertising by visiting Google's [My Ad Center](https://myadcenter.google.com/). You can also opt out of some third-party vendors' use of cookies for personalised advertising at [youradchoices.com](https://youradchoices.com/).
- Where the law requires it (for example in the European Economic Area, the UK and Switzerland), we ask for your consent before personalised ads or advertising cookies are used. You can change your choice at any time using **Cookie settings** in the footer.

For details, see [how Google uses information from sites that use its services](https://policies.google.com/technologies/partner-sites) and [how Google uses cookies in advertising](https://policies.google.com/technologies/ads).
{{/if}}

## Service providers we use

We share information only with providers that help us run the site, and only as needed:

- our web hosting provider (stores the site and its database and processes server logs);
{{#if resend}}
- Resend, which sends our confirmation and newsletter emails;
{{/if}}
{{#if postmark}}
- Postmark, which sends our confirmation and newsletter emails;
{{/if}}
{{#if turnstile}}
- Cloudflare Turnstile, which helps us tell people from bots on our forms;
{{/if}}
{{#if ga4}}
- Google (Analytics){{#if ads}} and Google (AdSense){{/if}}, as described above;
{{/if}}
{{#if !ga4}}
{{#if ads}}
- Google (AdSense), as described above;
{{/if}}
{{/if}}

We do not sell your personal information for money. Some US state privacy laws treat the use of advertising cookies for personalised ads as a "sale" or "sharing" of personal information; you can opt out using **Cookie settings**, and we honour Global Privacy Control signals sent by your browser.

## How long we keep information

- Contact messages: until your enquiry is resolved, then deleted within a reasonable period unless we need them for a legal reason.
{{#if newsletter}}
- Newsletter details: for as long as you stay subscribed. If you unsubscribe we keep only a record that you opted out.
{{/if}}
- Cookie choices: stored in your browser for up to 180 days.

## Legal bases (where data protection laws such as the GDPR apply)

- **Consent** — for optional cookies{{#if analytics}}, analytics{{/if}}{{#if ads}}, personalised advertising{{/if}}{{#if newsletter}} and the newsletter{{/if}}. You can withdraw consent at any time.
- **Legitimate interests** — to keep the site secure, prevent spam and answer messages you send us.
- **Legal obligation** — where we must keep or disclose information by law.

## Your rights

Depending on where you live, you may have the right to access, correct, delete or receive a copy of your personal information, to object to or restrict certain uses, and to withdraw consent. To make a request, contact us {{contactLine}}. You also have the right to complain to your local data protection authority.

## Children

This site is a general-audience craft resource. Articles about teaching children are written for parents and carers. We do not knowingly collect personal information from children under 13 (or the minimum age in your country). If you believe a child has sent us personal information, please contact us and we will delete it.

## International transfers

Our service providers may process information in other countries. Where required, we rely on appropriate safeguards such as standard contractual clauses.

## Security

We use HTTPS, restrict access to our admin tools, and keep the data we collect to a minimum. No method of transmission or storage is completely secure, but we work to protect your information.

## Changes to this policy

If we make important changes we will update the date at the top of this page{{#if ads}} and, where required, ask for your consent again{{/if}}.

## Contact

Questions about privacy? Contact us {{contactLine}}.
