import { useState, useEffect } from 'react';
import { Star, Loader2, CheckCircle2 } from 'lucide-react';
import { useReviewByOrder, useUpsertReview } from '@/hooks/useReviews';
import { useToast } from '@/hooks/use-toast';

interface Props {
  orderId: string;
  tenantId: string;
  supplierId: string | null;
}

const OrderReviewForm = ({ orderId, tenantId, supplierId }: Props) => {
  const { data: existing, isLoading } = useReviewByOrder(orderId);
  const upsert = useUpsertReview();
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (existing) {
      setRating(existing.rating);
      setComment(existing.comment || '');
    }
  }, [existing]);

  const submit = async () => {
    if (rating < 1) {
      toast({ title: 'Escolha uma nota de 1 a 5 estrelas', variant: 'destructive' });
      return;
    }
    try {
      await upsert.mutateAsync({
        order_id: orderId,
        tenant_id: tenantId,
        supplier_id: supplierId,
        rating,
        comment: comment.trim().slice(0, 500),
      });
      toast({ title: existing ? '✅ Avaliação atualizada!' : '⭐ Obrigado pela avaliação!' });
    } catch {
      toast({ title: 'Erro ao salvar avaliação', variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="rounded-xl border border-border bg-card p-4"><Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" /></div>;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="font-bold text-foreground flex items-center gap-2">
        {existing ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Star className="h-4 w-4 text-primary" />}
        {existing ? 'Sua avaliação' : 'Como foi seu pedido?'}
      </h3>
      <div className="flex items-center justify-center gap-1">
        {[1, 2, 3, 4, 5].map(n => {
          const filled = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className="p-1 transition-transform hover:scale-110"
              aria-label={`${n} estrelas`}
            >
              <Star className={`h-8 w-8 transition-colors ${filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
            </button>
          );
        })}
      </div>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="Comente sua experiência (opcional)"
        className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm resize-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{comment.length}/500</span>
        <button
          onClick={submit}
          disabled={upsert.isPending || rating < 1}
          className="rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : existing ? 'Atualizar' : 'Enviar avaliação'}
        </button>
      </div>
    </div>
  );
};

export default OrderReviewForm;
