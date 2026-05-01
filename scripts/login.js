const { chromium } = require("playwright");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { execSync } = require("child_process");

async function sendToTelegram(filePath, caption) {
  try {
    // 1. 检查环境变量是否存在
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      console.error("⚠️ 未配置 Telegram 环境变量，跳过发送");
      return;
    }

    // 2. 检查图片文件是否真的生成了
    if (!fs.existsSync(filePath)) {
      console.error(`⚠️ 找不到截图文件: ${filePath}，跳过发送`);
      return;
    }

    const telegramApi = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const formData = new FormData();
    formData.append("chat_id", process.env.TELEGRAM_CHAT_ID);
    formData.append("caption", caption);
    formData.append("photo", fs.createReadStream(filePath));

    await axios.post(telegramApi, formData, {
      headers: formData.getHeaders(),
      timeout: 15000 // 增加超时时间，防止网络死锁
    });
    
    console.log("✅ Telegram 通知发送成功");
  } catch (error) {
    console.error("❌ Telegram 通知发送失败:");
    // 打印 TG API 返回的真实错误信息（重要排查依据）
    if (error.response) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

// 解析多账号配置
function parseAccounts() {
  const accounts = [];
  
  const accountsConfig = process.env.SAP_ACCOUNTS;
  
  if (!accountsConfig) {
    throw new Error("未找到 SAP_ACCOUNTS 环境变量配置");
  }
  
  try {
    if (accountsConfig.trim().startsWith('[')) {
      return JSON.parse(accountsConfig);
    }
    
    const accountPairs = accountsConfig.split(';').filter(pair => pair.trim());
    
    for (const pair of accountPairs) {
      const [email, password] = pair.split(':').map(s => s.trim());
      if (email && password) {
        accounts.push({ email, password });
      }
    }
    
    return accounts;
  } catch (error) {
    throw new Error(`解析账号配置失败: ${error.message}`);
  }
}

async function loginWithAccount(browser, account, accountIndex) {
  const { email, password } = account;
  const SELECTORS = {
    emailInput: 'input[name="email"], input[id="j_username"]',
    emailSubmit: 'button[type="submit"], button[id="continue"], #logOnFormSubmit',
    passwordInput: 'input[type="password"], input[id="j_password"]',
    passwordSubmit: 'button[type="submit"], #logOnFormSubmit',
    // 同时匹配中文和英文按钮文本
    goToTrial: 'a:has-text("转到您的试用账户"), button:has-text("转到您的试用账户"), a:has-text("Go To Your Trial Account"), button:has-text("Go To Your Trial Account")',
    trialPageIndicator: '.trial-account, [class*="trial"], [data-testid*="trial"]'
  };

  const context = await browser.newContext();
  const page = await context.newPage();
  
  let success = false;
  
  try {
    console.log(`🌐 [账号${accountIndex + 1}] 打开 SAP BTP 登录页面...`);
    await page.goto("https://account.hanatrial.ondemand.com/");

    // Step 1: 输入邮箱
    console.log(`✉️ [账号${accountIndex + 1}] 输入邮箱: ${email}...`);
    await page.fill(SELECTORS.emailInput, email);
    console.log(`➡️ [账号${accountIndex + 1}] 点击继续...`);
    await page.click(SELECTORS.emailSubmit);

    // Step 2: 输入密码
    await page.waitForSelector(SELECTORS.passwordInput, { timeout: 15000 });
    console.log(`🔑 [账号${accountIndex + 1}] 输入密码...`);
    await page.fill(SELECTORS.passwordInput, password);
    console.log(`➡️ [账号${accountIndex + 1}] 点击登录...`);
    await page.click(SELECTORS.passwordSubmit);

    // 等待登录完成
    console.log(`⏳ [账号${accountIndex + 1}] 等待登录完成...`);
    await page.waitForTimeout(8000);

    // 检查是否登录成功
    const currentUrl = page.url();
    console.log(`🔗 [账号${accountIndex + 1}] 登录后URL: ${currentUrl}`);
    
    // 截图登录成功页面
    const loginScreenshot = `login-success-${accountIndex + 1}.png`;
    await page.screenshot({ path: loginScreenshot, fullPage: true });
    await sendToTelegram(loginScreenshot, `✅ [账号${accountIndex + 1}] SAP BTP 登录成功\n邮箱: ${email}`);

    // Step 3: 点击 "Go To Your Trial Account" 按钮
    console.log(`👉 [账号${accountIndex + 1}] 查找试用账户按钮...`);
    
    // 先尝试关闭可能的弹窗或banner
    try {
      const consentButton = await page.$('#truste-consent-button, .consent-button, [aria-label*="cookie"], [aria-label*="Cookie"]');
      if (consentButton) {
        console.log(`👉 [账号${accountIndex + 1}] 关闭 Consent Banner...`);
        await consentButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (bannerError) {
      console.log(`👉 [账号${accountIndex + 1}] 无 Consent Banner 或关闭失败`);
    }

    // 等待并点击试用账户按钮
    console.log(`👉 [账号${accountIndex + 1}] 等待试用账户按钮出现...`);
    
    try {
      // 等待按钮出现，使用更长的超时时间
      await page.waitForSelector(SELECTORS.goToTrial, { timeout: 30000, state: 'visible' });
      console.log(`✅ [账号${accountIndex + 1}] 找到试用账户按钮，准备点击...`);
      
      // 确保按钮在视图中并点击
      await page.click(SELECTORS.goToTrial, { force: true });
      console.log(`✅ [账号${accountIndex + 1}] 已点击试用账户按钮`);
      
      // 等待页面跳转
      await page.waitForTimeout(10000);
      
      // 检查是否成功跳转到试用页面
      const trialUrl = page.url();
      console.log(`🔗 [账号${accountIndex + 1}] 点击按钮后URL: ${trialUrl}`);
      
      if (trialUrl.includes('/trial/')) {
        console.log(`✅ [账号${accountIndex + 1}] 成功进入试用账户页面`);
        
        // 等待页面完全加载
        await page.waitForTimeout(5000);
        
        // 截图试用账户页面
        const trialScreenshot = `trial-account-${accountIndex + 1}.png`;
        await page.screenshot({ path: trialScreenshot, fullPage: true });
        await sendToTelegram(trialScreenshot, `✅ [账号${accountIndex + 1}] 已进入 SAP BTP 试用账户页面\n邮箱: ${email}`);
        
        success = true;
      } else {
        // 如果没有自动跳转，尝试直接导航到试用页面
        console.log(`🔄 [账号${accountIndex + 1}] 未自动跳转，尝试直接导航...`);
        await page.goto("https://account.hanatrial.ondemand.com/trial/");
        await page.waitForTimeout(8000);
        
        const finalUrl = page.url();
        if (finalUrl.includes('/trial/')) {
          const trialScreenshot = `trial-account-${accountIndex + 1}.png`;
          await page.screenshot({ path: trialScreenshot, fullPage: true });
          await sendToTelegram(trialScreenshot, `✅ [账号${accountIndex + 1}] 通过直接导航进入试用账户页面\n邮箱: ${email}`);
          success = true;
        } else {
          throw new Error('导航到试用页面失败');
        }
      }
    } catch (buttonError) {
      console.error(`❌ [账号${accountIndex + 1}] 处理试用账户按钮时出错:`, buttonError);
      
      // 尝试其他可能的选择器
      console.log(`🔍 [账号${accountIndex + 1}] 尝试其他选择器...`);
      const alternativeSelectors = [
        'a[href*="trial"]',
        'button[onclick*="trial"]',
        '[data-testid*="trial"]',
        '.trial-account-button',
        'a:has-text("Trial"), button:has-text("Trial")'
      ];
      
      let foundAlternative = false;
      for (const selector of alternativeSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            console.log(`✅ [账号${accountIndex + 1}] 使用备选选择器: ${selector}`);
            await element.click();
            await page.waitForTimeout(8000);
            foundAlternative = true;
            break;
          }
        } catch (altError) {
          // 继续尝试下一个选择器
        }
      }
      
      if (!foundAlternative) {
        throw new Error(`找不到试用账户按钮: ${buttonError.message}`);
      }
    }

    if (success) {
      console.log(`🎉 [账号${accountIndex + 1}] 登录流程完成`);
    }
    
  } catch (err) {
    console.error(`❌ [账号${accountIndex + 1}] 登录或进入试用账户失败:`, err);
    try {
      const errorPath = `error-${accountIndex + 1}.png`;
      await page.screenshot({ path: errorPath, fullPage: true });
      await sendToTelegram(errorPath, `❌ [账号${accountIndex + 1}] SAP BTP 操作失败\n邮箱: ${email}\n错误: ${err.message}`);
      console.log(`🚨 [账号${accountIndex + 1}] 失败截图已发送到 Telegram`);
    } catch (screenshotErr) {
      console.error(`📷 [账号${accountIndex + 1}] 截图失败:`, screenshotErr);
    }
  } finally {
    await context.close();
  }
  
  return success;
}

(async () => {
  let browser;
  const results = [];
  
  try {
    const accounts = parseAccounts();
    console.log(`🔍 找到 ${accounts.length} 个账号需要登录`);
    
    if (accounts.length === 0) {
      throw new Error("未配置有效的账号信息");
    }

    try {
      browser = await chromium.launch({ 
        headless: true,
        // 增加超时时间
        timeout: 60000
      });
    } catch (err) {
      console.warn("⚠️ Playwright 浏览器未安装，正在自动安装 Chromium...");
      execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
      browser = await chromium.launch({ 
        headless: true,
        timeout: 60000
      });
    }

    for (let i = 0; i < accounts.length; i++) {
      console.log(`\n📝 开始处理第 ${i + 1} 个账号...`);
      const success = await loginWithAccount(browser, accounts[i], i);
      results.push({
        account: accounts[i].email,
        success: success
      });
      
      if (i < accounts.length - 1) {
        console.log(`⏳ 等待 5 秒后处理下一个账号...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    const summary = `📊 SAP BTP 多账号登录完成报告\n\n` +
                   `✅ 成功: ${successCount}/${totalCount}\n` +
                   `❌ 失败: ${totalCount - successCount}/${totalCount}\n\n` +
                   `详情:\n` +
                   results.map((r, i) => 
                     `${r.success ? '✅' : '❌'} 账号${i + 1}: ${r.account}`
                   ).join('\n');
    
    // 发送汇总报告
    if (results.length > 0 && results.some(r => r.success)) {
      // 使用第一个成功的账号的截图
      const successIndex = results.findIndex(r => r.success);
      const screenshotFile = `trial-account-${successIndex + 1}.png`;
      await sendToTelegram(screenshotFile, summary);
    } else if (results.length > 0) {
      // 如果没有成功的，使用第一个错误的截图
      const screenshotFile = `error-1.png`;
      if (fs.existsSync(screenshotFile)) {
        await sendToTelegram(screenshotFile, summary);
      }
    }
    
    console.log(`\n🎯 所有账号处理完成！成功: ${successCount}/${totalCount}`);
    
    if (successCount < totalCount) {
      process.exit(1);
    }
    
  } catch (err) {
    console.error("💥 脚本执行失败:", err);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
