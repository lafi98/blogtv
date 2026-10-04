import { getCategoryBySlug, listCategories } from './repos/categories';
import { listPublishedCards } from './repos/articles';
import { perPage } from './listing';

export function loadCategoryPage(slug: string | undefined, page: number) {
  if (!slug || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const category = getCategoryBySlug(slug);
  if (!category) return null;
  const size = perPage();
  const { items, total } = listPublishedCards({ categoryId: category.id, limit: size, offset: (page - 1) * size });
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (page > totalPages) return null;
  return { category, items, total, totalPages, categories: listCategories() };
}
