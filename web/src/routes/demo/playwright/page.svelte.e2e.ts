import { expect, test } from '@playwright/test';

test('tiene el h1 esperado', async ({ page }) => {
	await page.goto('/demo/playwright');
	await expect(page.locator('h1')).toBeVisible();
});
