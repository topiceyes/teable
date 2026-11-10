import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { DirectoryPage } from '@/features/app/blocks/admin/directory/DirectoryPage';
import { AdminLayout } from '@/features/app/layouts/AdminLayout';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR, { ForbiddenError } from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Directory: NextPageWithLayout = () => <DirectoryPage />;
export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const user = await ssrApi.getUserMe();
      if (!user?.isAdmin) throw new ForbiddenError();
      return { props: { ...(await getTranslationsProps(context, 'common')) } };
    })
  )
);
Directory.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <AdminLayout {...pageProps}>{page}</AdminLayout>;
};
export default Directory;
