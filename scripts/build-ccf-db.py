#!/usr/bin/env python3
"""从 CCF 官网抓取会议和期刊数据 - https://ccf.atom.im/"""

import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime

def fetch_ccf_data():
    response = requests.get(
        "https://ccf.atom.im/",
        headers={'User-Agent': 'Mozilla/5.0'},
        timeout=30
    )
    response.encoding = 'utf-8'
    
    soup = BeautifulSoup(response.text, 'html.parser')
    tables = soup.find_all('table')
    
    conferences, journals = [], []
    
    for table in tables:
        for row in table.find_all('tr'):
            cols = row.find_all('td')
            if len(cols) < 5:
                continue
            
            abbr = cols[0].get_text(strip=True)
            full_name = cols[1].get_text(strip=True)
            rank = cols[2].get_text(strip=True)
            item_type = cols[3].get_text(strip=True)
            category = cols[4].get_text(strip=True)
            
            if rank not in ['A', 'B', 'C'] or not abbr:
                continue
            
            entry = {
                "abbr": abbr,
                "fullName": full_name,
                "rank": rank,
                "category": category
            }
            
            if '会议' in item_type:
                conferences.append(entry)
            elif '期刊' in item_type:
                journals.append(entry)
    
    return conferences, journals

if __name__ == "__main__":
    print("正在抓取 CCF 数据...")
    
    conferences, journals = fetch_ccf_data()
    
    ccf_data = {
        "version": "2022",
        "updateDate": datetime.now().strftime("%Y-%m-%d"),
        "conferences": conferences,
        "journals": journals
    }
    
    with open("src/data/ccf-conferences.json", 'w', encoding='utf-8') as f:
        json.dump(ccf_data, f, ensure_ascii=False, indent=4)
    
    print(f"✓ 完成: {len(conferences)} 会议, {len(journals)} 期刊")
