## 这个小脚本有什么用?

![image.png](https://s.web.cafe/image/9ae75015d5fb4f79b1c8ee2c9fb471cf.png)

## 效果

![image.png](https://s.web.cafe/image/15eb8cbee46241d6bc28731cee6f97ea.png)

## 简单版

### pip install requests

### 执行 python3 xx.py

```


`import requests import xml.etree.ElementTree as ET from typing import List def get_suggestions(query: str) -> List[str]:     """     获取 Google 搜索建议         Args:         query: 搜索关键词         Returns:         包含搜索建议的字符串列表     """     url = "https://suggestqueries.google.com/complete/search"     params = {         "output": "toolbar",         "hl": "en",         "q": query    }          try:         response = requests.get(url, params=params)         response.raise_for_status()  # 检查请求是否成功                 # 解析 XML 响应        root = ET.fromstring(response.text)         suggestions = [suggestion.get('data') for suggestion in root.findall('.//suggestion')]                  return suggestions         except requests.RequestException as e:         print(f"请求出错: {e}")         return []     except ET.ParseError as e:         print(f"XML 解析出错: {e}")         return [] def main():     # 示例使用     query = input("请输入搜索关键词: ")     suggestions = get_suggestions(query)          print("\n搜索建议:")     for i, suggestion in enumerate(suggestions, 1):         print(f"{i}. {suggestion}") if __name__ == "__main__":     main()` 


```

批量，复杂的版本 ![image.png](https://s.web.cafe/image/0b5c9f703cbf4320922773d97aa8bf58.png)

```


`import requests import xml.etree.ElementTree as ET from typing import List, Set from queue import Queue from threading import Thread import time import os from datetime import datetime class SuggestionWorker:     def __init__(self, main_keyword: str, output_dir: str = "results", num_workers: int = 2):         """         初始化搜索建议爬虫                  Args:             main_keyword: 主要关键词，必须包含在结果中            output_dir: 输出目录            num_workers: 并发工作线程数        """         self.main_keyword = main_keyword.lower()         self.num_workers = num_workers                 # 创建输出目录         self.output_dir = output_dir        os.makedirs(output_dir, exist_ok=True)                  # 创建带时间戳的输出文件         timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")         self.output_file = os.path.join(output_dir, f"suggestions_{main_keyword}_{timestamp}.txt")                  # 初始化队列和集合         self.queue = Queue()         self.results: Set[str] = set()         self.processed_queries: Set[str] = set()         self.depth_map = {}  # 记录每个关键词的深度         def get_suggestions(self, query: str) -> List[str]:         """获取 Google 搜索建议"""         url = "https://suggestqueries.google.com/complete/search"         params = {             "output": "toolbar",             "hl": "en",             "q": query        }                  try:             response = requests.get(url, params=params)             response.raise_for_status()                          root = ET.fromstring(response.text)             suggestions = [suggestion.get('data') for suggestion in root.findall('.//suggestion')]                          # 只保留包含主关键词的建议             filtered_suggestions = [s for s in suggestions if self.main_keyword in s.lower()]             return filtered_suggestions                     except (requests.RequestException, ET.ParseError) as e:             print(f"处理查询 '{query}' 时出错: {e}")             return []     def save_suggestion(self, suggestion: str):         """保存建议词到文件"""         with open(self.output_file, 'a', encoding='utf-8') as f:             f.write(f"{suggestion}\n")     def worker(self):         """工作线程函数"""         while True:             try:                 query = self.queue.get()                 if query is None:                     break                                      if query in self.processed_queries:                     self.queue.task_done()                     continue                                      print(f"正在处理: {query}")                 self.processed_queries.add(query)                 suggestions = self.get_suggestions(query)                                  # 保存新的建议并添加到队列                 for suggestion in suggestions:                     if suggestion not in self.results:                         self.results.add(suggestion)                         self.save_suggestion(suggestion)                         # 将新的建议加入队列继续扩展                         self.queue.put(suggestion)                                  time.sleep(1)  # 避免请求过快                             except Exception as e:                 print(f"处理时出错: {e}")             finally:                 self.queue.task_done()     def run(self):         """运行爬虫"""         print(f"开始收集包含 '{self.main_keyword}' 的搜索建议...")         print(f"结果将保存到: {self.output_file}")                  # 清空或创建输出文件         with open(self.output_file, 'w', encoding='utf-8') as f:             f.write(f"关键词\n")  # 写入表头                     # 添加初始关键词         self.queue.put(self.main_keyword)                  # 启动工作线程         threads = []         for _ in range(self.num_workers):             t = Thread(target=self.worker)             t.start()             threads.append(t)                  # 等待队列处理完成         self.queue.join()                  # 停止工作线程         for _ in range(self.num_workers):             self.queue.put(None)         for t in threads:             t.join()                  print(f"\n已完成! 共收集到 {len(self.results)} 个建议关键词")         print(f"结果已保存到: {self.output_file}") def main():     main_keyword = input("请输入主要关键词: ").strip()          crawler = SuggestionWorker(         main_keyword=main_keyword,         num_workers=2     )          crawler.run() if __name__ == "__main__":     main()` 


```

## 说明文档，

## Google 搜索建议爬虫

这是一个用于收集 Google 搜索建议的爬虫工具。它可以递归地获取所有包含指定关键词的搜索建议。

## 功能特点

-   递归获取搜索建议
-   多线程并发处理
-   自动过滤，确保结果包含主关键词
-   结果自动去重
-   实时保存到文件
-   支持断点续爬（每次运行生成新文件）

## 使用方法

1.  安装依赖：

```


``3. 输入主关键词，例如 "python" ## 工作原理  程序会按以下步骤工作：  1. 输入主关键词（如 "python"） 2. 第一次获取包含主关键词的建议词，例如：   - python programming   - python tutorial   - python for beginners 3. 然后对每个获取到的建议词继续搜索：   - 用 "python programming" 继续搜索   - 用 "python tutorial" 继续搜索   - 用 "python for beginners" 继续搜索 4. 每次搜索都只保留包含主关键词的结果 5. 这个过程会一直持续，直到没有新的建议词 ## 输出说明  - 结果保存在 `results` 目录下 - 文件名格式：`suggestions_关键词_时间戳.txt` - 每行一个关键词 - 所有关键词都包含主关键词 - 结果自动去重 ## 技术细节  - 使用 Google Suggest API - 多线程并发（默认 2 个线程） - 请求延迟 1 秒，避免 API 限制 - 使用队列（Queue）管理待处理关键词 - 使用集合（Set）实现结果去重 ## 注意事项  1. 确保网络可以访问 Google 服务 2. 程序会一直运行到没有新的建议词 3. 可以随时中断，已处理的结果会保存在文件中 4. 每次运行会创建新的结果文件，不会覆盖旧结果 ## 依赖要求  - Python 3.6+ - requests>=2.31.0 ## 目录结构``



```

. ├── google\_suggest.py # 主程序 ├── requirements.txt # 依赖文件 └── results/ # 结果目录 └── suggestions\_\*.txt # 结果文件

```


`## 示例运行  ```bash $ python google_suggest.py 请输入主要关键词: python 开始收集包含 'python' 的搜索建议... 正在处理: python 正在处理: python programming 正在处理: python tutorial ... 已完成! 共收集到 xxx 个建议关键词 结果已保存到: results/suggestions_python_20240321_123456.txt`


```

## 以上，用 ai 搞出来的小脚本，技术大佬还可以优化下。这小脚本默认大家都会一点点编程，python，不会的复制粘贴下去运行，

## 不要试图把线程调大，那样会被和谐 ip 的，我叫睡飞，我在 6 群。多交流谢谢。