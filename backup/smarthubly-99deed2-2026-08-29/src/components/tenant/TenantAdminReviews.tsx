import { useTenantReviews } from '@/hooks/useReviews';
import ReviewsList from './ReviewsList';

const TenantAdminReviews = ({ tenantId }: { tenantId: string }) => {
  const { data: reviews = [], isLoading } = useTenantReviews(tenantId);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Avaliações dos Clientes</h2>
      <ReviewsList reviews={reviews} loading={isLoading} />
    </div>
  );
};

export default TenantAdminReviews;
