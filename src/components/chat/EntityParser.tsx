import React from "react";

interface TextEntity {
  offset: number;
  length: number;
  type: {
    "@type": string;
    url?: string;
    language?: string;
    [key: string]: any;
  };
}

interface EntityParserProps {
  text: string;
  entities?: TextEntity[];
}

export const EntityParser: React.FC<EntityParserProps> = ({ text, entities = [] }) => {
  if (!entities || entities.length === 0) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  // Sort entities by offset
  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  const elements: React.ReactNode[] = [];
  let currentIndex = 0;

  for (let i = 0; i < sorted.length; i++) {
    const ent = sorted[i];
    const { offset, length, type } = ent;

    // Plain text before entity
    if (offset > currentIndex) {
      elements.push(
        <span key={`plain-${currentIndex}`} className="whitespace-pre-wrap break-words">
          {text.slice(currentIndex, offset)}
        </span>
      );
    }

    const chunk = text.slice(offset, offset + length);
    const entityType = type["@type"];

    switch (entityType) {
      case "textEntityTypeBold":
        elements.push(
          <strong key={`bold-${offset}`} className="font-bold">
            {chunk}
          </strong>
        );
        break;

      case "textEntityTypeItalic":
        elements.push(
          <em key={`italic-${offset}`} className="italic">
            {chunk}
          </em>
        );
        break;

      case "textEntityTypeCode":
        elements.push(
          <code
            key={`code-${offset}`}
            className="px-1.5 py-0.5 rounded bg-black/20 font-mono text-[0.9em] border border-white/10"
          >
            {chunk}
          </code>
        );
        break;

      case "textEntityTypePre":
      case "textEntityTypePreCode":
        elements.push(
          <pre
            key={`pre-${offset}`}
            className="p-2 rounded bg-black/30 font-mono text-xs overflow-x-auto my-1 border border-white/10"
          >
            <code>{chunk}</code>
          </pre>
        );
        break;

      case "textEntityTypeTextUrl":
      case "textEntityTypeUrl":
        elements.push(
          <a
            key={`url-${offset}`}
            href={type.url || chunk}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-primary)] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {chunk}
          </a>
        );
        break;

      case "textEntityTypeBlockQuote":
        elements.push(
          <blockquote
            key={`quote-${offset}`}
            className="border-l-2 border-[var(--accent-primary)] pl-2 my-1 italic text-[var(--text-secondary)]"
          >
            {chunk}
          </blockquote>
        );
        break;

      case "textEntityTypeSpoiler":
        elements.push(
          <span
            key={`spoiler-${offset}`}
            className="bg-[var(--text-muted)] hover:bg-transparent rounded px-1 cursor-pointer transition-colors"
            title="Click to reveal spoiler"
          >
            {chunk}
          </span>
        );
        break;

      default:
        elements.push(
          <span key={`default-${offset}`} className="whitespace-pre-wrap break-words">
            {chunk}
          </span>
        );
        break;
    }

    currentIndex = offset + length;
  }

  // Trailing text
  if (currentIndex < text.length) {
    elements.push(
      <span key={`plain-${currentIndex}`} className="whitespace-pre-wrap break-words">
        {text.slice(currentIndex)}
      </span>
    );
  }

  return <>{elements}</>;
};
