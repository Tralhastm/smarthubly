import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { normalizeProductDescription } from '@/lib/product-description';

const PREVIEW_CHARS = 280;

type ExpandableProductDescriptionProps = {
  value: unknown;
  className?: string;
  onOpenDetails?: () => void;
};

export const ExpandableProductDescription = ({ value, className = '', onOpenDetails }: ExpandableProductDescriptionProps) => {
  const description = normalizeProductDescription(value);
  const [expanded, setExpanded] = useState(false);

  if (!description) return null;
  if (description.length <= PREVIEW_CHARS) {
    return <p className={className}>{description}</p>;
  }

  const preview = `${description.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '').trim()}...`;

  return (
    <div>
      <p className={className}>{expanded ? description : preview}</p>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (onOpenDetails) onOpenDetails();
          else setExpanded(current => !current);
        }}
        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        aria-expanded={expanded}
      >
        {onOpenDetails ? 'Ver mais' : expanded ? 'Ver menos' : 'Ver mais'}
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
};
