import { Star, MessageSquare } from 'lucide-react';
import { computeAverage, type Review } from '@/hooks/useReviews';

interface Props {
  reviews: Review[];
  loading?: boolean;
}

const ReviewsList = ({ reviews, loading }: Props) => {
  const { avg, count } = computeAverage(reviews);

  if (loading) return <p className="text-center text-muted-foreground py-4 text-sm">Carregando avaliações…</p>;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
        <div className="rounded-lg bg-yellow-500/10 p-2">
          <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{count > 0 ? avg.toFixed(1) : '—'}</p>
          <p className="text-xs text-muted-foreground">{count} {count === 1 ? 'avaliação' : 'avaliações'}</p>
        </div>
        {count > 0 && (
          <div className="ml-auto flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} className={`h-4 w-4 ${avg >= n ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
            ))}
          </div>
        )}
      </div>

      {reviews.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
          <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-50" />
          Ainda sem avaliações. Quando clientes avaliarem, aparecem aqui.
        </div>
      )}

      <div className="space-y-2">
        {reviews.map(r => (
          <div key={r.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <Star key={n} className={`h-3.5 w-3.5 ${r.rating >= n ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
            {r.comment && <p className="text-sm text-foreground">{r.comment}</p>}
            <p className="text-[10px] text-muted-foreground">Pedido #{r.order_id.slice(0, 8)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReviewsList;
