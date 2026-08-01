import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "react-email";

export type StockRadarAlertEmailProps = {
  preview: string; ticker?: string; company?: string; category: string; source?: string; eventTime?: string;
  headline: string; quickTake: string; facts: Array<{ label: string; value: string; color?: string }>;
  liveRoomUrl?: string; analysisUrl?: string; settingsUrl: string; unsubscribeUrl: string;
};

export function StockRadarAlertEmail(props: StockRadarAlertEmailProps) {
  const title = [props.ticker ? `$${props.ticker}` : "Market", props.company].filter(Boolean).join(" · ");
  return <Html lang="en"><Head /><Preview>{props.preview}</Preview><Body style={body}><Container style={container}>
    <Text style={brand}>STOCK RADAR</Text><Heading style={heading}>{title}</Heading>
    <Text style={meta}>{[props.category, props.source, props.eventTime].filter(Boolean).join(" · ")}</Text>
    <Heading as="h2" style={headline}>{props.headline}</Heading><Text style={quickTake}>{props.quickTake}</Text>
    {props.facts.length ? <Section style={facts}>{props.facts.map((fact) => <Text key={fact.label} style={factText}>
      <span style={factLabel}>{fact.label}</span>{" "}<span style={{ color: fact.color || "#d9e2f2", fontWeight: 700 }}>{fact.value}</span>
    </Text>)}</Section> : null}
    {props.liveRoomUrl ? <Button href={props.liveRoomUrl} style={primaryButton}>Enter {props.ticker} Live Room</Button> : null}
    {props.analysisUrl ? <Button href={props.analysisUrl} style={secondaryButton}>View Analysis</Button> : null}
    <Text style={settingsText}><Link href={props.settingsUrl} style={link}>Alert settings</Link></Text><Hr style={rule} />
    <Text style={footer}>For information only. Alerts may be delayed or unavailable and are not investment advice.</Text>
    <Text style={footer}>Turn off only the Email channel: <Link href={props.unsubscribeUrl} style={footerLink}>unsubscribe from alert emails</Link>.</Text>
  </Container></Body></Html>;
}

const body = { margin: 0, backgroundColor: "#0b1020", color: "#f4f7fb", fontFamily: "Arial, Helvetica, sans-serif" };
const container = { width: "100%", maxWidth: "600px", margin: "0 auto", padding: "32px 24px", boxSizing: "border-box" as const };
const brand = { margin: "0 0 16px", color: "#51d6a5", fontSize: "12px", fontWeight: 800, letterSpacing: "1.6px" };
const heading = { margin: "0 0 8px", color: "#ffffff", fontSize: "28px", lineHeight: "34px" };
const meta = { margin: "0 0 24px", color: "#9eacc4", fontSize: "13px", lineHeight: "20px" };
const headline = { margin: "0 0 12px", color: "#ffffff", fontSize: "20px", lineHeight: "28px" };
const quickTake = { margin: "0 0 24px", color: "#d9e2f2", fontSize: "16px", lineHeight: "25px" };
const facts = { margin: "0 0 24px", border: "1px solid #27344d", borderRadius: "10px", padding: "12px 16px", backgroundColor: "#111a2d" };
const factText = { margin: "5px 0", fontSize: "14px", lineHeight: "20px" }; const factLabel = { color: "#9eacc4", fontWeight: 600 };
const primaryButton = { display: "block", margin: "0 0 10px", borderRadius: "8px", padding: "13px 18px", backgroundColor: "#37c790", color: "#07150f", fontSize: "15px", fontWeight: 800, textAlign: "center" as const, textDecoration: "none" };
const secondaryButton = { ...primaryButton, backgroundColor: "#24314b", color: "#ffffff" }; const settingsText = { margin: "20px 0 0", textAlign: "center" as const, fontSize: "13px" };
const link = { color: "#8bbcff", textDecoration: "underline" }; const rule = { margin: "28px 0 18px", borderColor: "#27344d" };
const footer = { margin: "6px 0", color: "#8290a8", fontSize: "12px", lineHeight: "18px" }; const footerLink = { color: "#aebad0", textDecoration: "underline" };
