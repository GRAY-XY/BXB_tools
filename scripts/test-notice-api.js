#!/usr/bin/env node

/**
 * 测试通知 API 端点
 * 
 * 用法：
 *   node scripts/test-notice-api.js
 */

import { BanxuebangClient } from '../src/banxuebang-client.js';
import { SessionStore } from '../src/session-store.js';

async function main() {
  console.log('=== 测试通知 API ===\n');
  
  const client = new BanxuebangClient(new SessionStore());
  
  try {
    // 1. 检查会话状态
    console.log('1. 检查会话状态...');
    const session = await client.getSession();
    const summary = client.summarizeSession(session);
    
    if (!summary.ready) {
      console.error('❌ 会话未就绪，请先登录');
      console.log('\n运行以下命令登录：');
      console.log('  node scripts/call-tool.js login_in_browser');
      process.exit(1);
    }
    
    console.log(`✓ 已登录用户: ${summary.userInfo?.userName || 'Unknown'}`);
    console.log(`✓ 当前学期: ${summary.currentTermName || summary.currentTermId}`);
    console.log();
    
    // 2. 测试通知 API
    console.log('2. 测试通知 API...');
    console.log('   尝试端点: /gateway/bxb/notice/user/{userId}/list');
    
    try {
      const result = await client.listNotices({ page: 1, size: 20 });
      console.log(`✓ API 调用成功！`);
      console.log(`   通知数量: ${result.notices?.length || 0}`);
      console.log(`   总数: ${result.total || 0}`);
      
      if (result.notices && result.notices.length > 0) {
        console.log('\n最近的通知:');
        result.notices.slice(0, 5).forEach((notice, index) => {
          console.log(`\n  ${index + 1}. ${notice.title || notice.noticeTitle || '无标题'}`);
          console.log(`     发送者: ${notice.sender || notice.publisherName || '未知'}`);
          console.log(`     时间: ${notice.time || notice.publishTime || notice.createTime || '未知'}`);
          console.log(`     内容预览: ${(notice.content || notice.noticeContent || '').substring(0, 50)}...`);
          console.log(`     已读: ${notice.read || notice.isRead ? '是' : '否'}`);
        });
      } else {
        console.log('\n  当前没有通知数据');
      }
      
    } catch (apiError) {
      console.error(`✗ API 调用失败: ${apiError.message}`);
      
      // 3. 尝试其他可能的端点
      console.log('\n3. 尝试其他可能的通知端点...');
      
      const alternativeEndpoints = [
        `/gateway/bxb/bulletin/user/${session.context.userInfo.id}/list`,
        `/gateway/bxb/announcement/user/${session.context.userInfo.id}/list`,
        `/gateway/platform/notice/user/${session.context.userInfo.id}/list`,
        `/gateway/bxb/notice/student/${session.context.userInfo.id}`,
        `/gateway/bxb/notice/list`,
      ];
      
      for (const endpoint of alternativeEndpoints) {
        try {
          console.log(`\n   尝试: ${endpoint}`);
          const response = await client.request(session, 'GET', endpoint, {
            params: { page: 1, size: 20, userType: 'S' }
          });
          console.log(`   ✓ 成功！响应:`, JSON.stringify(response, null, 2).substring(0, 200));
          break;
        } catch (err) {
          console.log(`   ✗ 失败: ${err.message}`);
        }
      }
    }
    
    // 4. 检查未读计数
    console.log('\n4. 检查其他可能包含通知的数据源...');
    
    // 尝试从 dashboard 获取
    console.log('   - 检查 dashboard 数据...');
    const contextSummary = await client.refreshContext(session);
    console.log(`     上下文中的数据字段: ${Object.keys(contextSummary).join(', ')}`);
    
  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
  
  console.log('\n=== 测试完成 ===');
}

main();
