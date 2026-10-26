'use strict';
/* A sample course written by hand, so the whole learning journey (lessons, quizzes, final exam, signed certificate) works with
   NO AI at all: for demos, for offline-first pilots, and for days when the AI service is out of quota or down.
   Its quizzes draw from a fixed bank of questions (shuffled every attempt) and are marked by answer key.
   It is about everyday money skills, which is deliberately not a developer topic. */
const crypto = require('node:crypto');

const ID = 'crs_5eed000001';

const q = (question, options, correct, explain) => ({ type: 'mcq', question, options, correct, explain });

const course = {
  id: ID, static: true, topic: 'Personal budgeting', level: 'beginner', kind: 'general',
  title: 'Personal Budgeting Basics',
  summary: 'Learn to plan, track and adjust your own money so that you spend on purpose, save for goals and handle surprises without panic. A short sample course written by the SkillBridge team.',
  audience: 'Anyone starting to manage their own money: students, first-time earners, people on irregular income',
  outcomes: ['Learners will be able to explain what a budget is and why it helps', 'Learners will be able to find out where their money actually goes', 'Learners will be able to build a simple monthly budget that balances', 'Learners will be able to plan for emergencies and irregular costs', 'Learners will be able to review and adjust a budget each month'],
  disclaimer: 'This course is general education about everyday money habits. It is not personal financial advice.',
  modules: [
    { id: 'm1', title: 'Why a budget?', summary: 'What a budget is, and how to see where your money really goes.', lessons: [{ id: 'l1-1', title: 'What a budget is (and is not)', minutes: 7 }, { id: 'l1-2', title: 'Finding out where your money goes', minutes: 8 }] },
    { id: 'm2', title: 'Building your budget', summary: 'Turning income into a plan that balances.', lessons: [{ id: 'l2-1', title: 'Needs, wants and savings', minutes: 8 }, { id: 'l2-2', title: 'Making the numbers work', minutes: 9 }] },
    { id: 'm3', title: 'Staying on track', summary: 'Handling surprises and keeping the plan alive.', lessons: [{ id: 'l3-1', title: 'Emergency funds and irregular costs', minutes: 8 }, { id: 'l3-2', title: 'Reviewing and adjusting every month', minutes: 7 }] },
  ],
  sources: [], research: 'none',
};

const lessons = {
  'l1-1': {
    title: 'What a budget is (and is not)', moduleId: 'm1',
    intro: 'A budget has a reputation for being strict and joyless. In this lesson you will see what it really is: a simple plan that puts you in charge of your money instead of wondering where it went.',
    sections: [
      { heading: 'A plan, not a punishment', body: 'A budget is a plan for your money, made **before** you spend it. You list the money you expect to receive, then decide what each part of it is for: rent, food, transport, savings, fun.\n\nThe point is not to say no to everything. The point is that spending becomes a choice you made on purpose, instead of something that just happened at the end of the month.' },
      { heading: 'The one rule that makes it work', body: 'A budget has one rule: **the plan must balance**. Money coming in minus every planned use of it should equal zero. If you plan to spend more than you earn, the plan is already broken before the month starts.\n\n- Income is money you expect to receive.\n- Every unit of income gets a job: a bill, a goal, or a treat.\n- Nothing is left floating without a purpose.' },
      { heading: 'What a budget is not', body: 'A budget is not a record of the past, and it is not a promise that you will be perfect. You will overspend on something sometimes. That is normal, and it is exactly why you review the budget and adjust it.\n\nIt is also not only for people with little money. People with large incomes can lose track of spending too. The habit of planning matters at any income.' },
    ],
    example: { title: 'Ada gives every naira a job', scenario: 'Ada earns 120,000 a month. She used to reach the 20th with nothing left and no idea why.', walkthrough: 'She writes her income at the top. Under it she lists rent 45,000, food 30,000, transport 15,000, phone and data 5,000, and savings 10,000. That totals 105,000, so 15,000 is still unplanned. She gives it jobs: 8,000 for fun and 7,000 for a small buffer. Now the plan adds up to 120,000 and every part has a purpose.' },
    keyTerms: [{ term: 'Budget', meaning: 'A plan for how you will use the money you expect to receive.' }, { term: 'Income', meaning: 'Money coming in, such as salary, allowance or earnings.' }, { term: 'Balanced budget', meaning: 'A plan where income minus all planned uses equals zero.' }],
    checks: [{ question: 'What does it mean for a budget to balance?', answer: 'Income minus everything you plan to do with the money equals zero, so every unit has a purpose.' }, { question: 'Is a budget a record of what you already spent?', answer: 'No. It is a plan made before you spend. Tracking what you spent is a separate step that helps you adjust it.' }],
    recap: ['A budget is a plan for money, made before you spend it.', 'A good plan balances: income minus planned uses is zero.', 'You will not follow it perfectly, so you review and adjust.'],
  },
  'l1-2': {
    title: 'Finding out where your money goes', moduleId: 'm1',
    intro: 'You cannot plan well without knowing where your money goes today. This lesson shows a simple way to find out, without any special tools.',
    sections: [
      { heading: 'Look back before you plan ahead', body: 'Before building a budget, spend one month simply **noticing**. Write down or screenshot every payment: shopping, transport, data, snacks, transfers to family. A notebook, a notes app or your bank statement all work.\n\nDo not try to change anything yet. The goal is an honest picture. People are often surprised by small repeated costs that add up, such as daily snacks or small top-ups.' },
      { heading: 'Sort spending into groups', body: 'At the end of the month, sort the payments into a few groups. A simple set is:\n\n- Housing and utilities\n- Food\n- Transport\n- Phone and data\n- Family and giving\n- Fun and extras\n- Savings and debt payments\n\nAdd up each group. Now you can see which groups are large and which are small.' },
      { heading: 'Fixed and variable costs', body: 'Some costs are **fixed**: they stay about the same each month, like rent or a subscription. Others are **variable**: they change, like food or transport.\n\nFixed costs are easy to plan. Variable costs need a realistic estimate based on what you found. Your tracking month gives you that estimate, so you are guessing from facts instead of hope.' },
    ],
    example: { title: 'Kofi tracks one month', scenario: 'Kofi thinks he spends little on snacks. He tracks everything for a month.', walkthrough: 'He sorts his payments into groups and finds snacks and drinks came to a bigger share of his money than he expected, spread over many small purchases. He does not feel guilty; he now has a real number. When he builds his budget he gives snacks a realistic amount instead of pretending they cost nothing.' },
    keyTerms: [{ term: 'Tracking', meaning: 'Recording what you actually spend, to see the real picture.' }, { term: 'Fixed cost', meaning: 'A cost that stays about the same each month, like rent.' }, { term: 'Variable cost', meaning: 'A cost that changes from month to month, like food.' }],
    checks: [{ question: 'Why track spending before changing it?', answer: 'To get an honest picture of where money goes, so the budget is built on facts and not guesses.' }, { question: 'Is a monthly phone plan with a set price fixed or variable?', answer: 'Fixed: it costs the same each month.' }],
    recap: ['Track a month of real spending before you plan.', 'Sort payments into a few simple groups and add them up.', 'Fixed costs stay the same; variable costs need realistic estimates.'],
  },
  'l2-1': {
    title: 'Needs, wants and savings', moduleId: 'm2',
    intro: 'Once you know where your money goes, you can decide where it should go. A simple way to start is to split spending into needs, wants and savings.',
    sections: [
      { heading: 'Needs, wants and savings', body: '**Needs** are things you must pay to live and work: housing, basic food, transport to work or school, essential bills, minimum debt payments.\n\n**Wants** are things that make life nicer but could be reduced or skipped: eating out, entertainment, extra clothes.\n\n**Savings** are money you set aside for later: an emergency fund, a goal, or investments. Paying yourself first means planning savings at the start, not hoping something is left over.' },
      { heading: 'A starting split, not a law', body: 'Some people use a simple starting split such as roughly half for needs, a smaller part for wants and a part for savings. Treat any such split as a **starting point**, not a rule.\n\nIf your rent takes most of your income, your needs share will be larger and that is fine. What matters is that the plan balances and that savings get a real line in it, even if it is small at first.' },
      { heading: 'Telling a need from a want', body: 'The line is not always clear. Transport to work is a need, but a taxi every day when a cheaper option exists is partly a want. Food is a need, but a restaurant meal is partly a want.\n\nAsk: *What happens if I skip or reduce this?* If the answer is that you could not work, eat or stay housed, it is a need. If life would just be a little less fun, it leans toward a want.' },
    ],
    example: { title: 'Maria sorts her month', scenario: 'Maria earns 200 a week. Her rent, food, bus pass and phone come to 120. She spends about 50 on outings and takeaway and saves nothing.', walkthrough: 'Needs are 120 (rent, food, bus pass, phone). Wants are 50. That leaves 30 that has no job. She decides to save 20 and give the last 10 to a buffer for small surprises. Now needs 120 + wants 50 + savings 20 + buffer 10 equals her 200 income.' },
    keyTerms: [{ term: 'Need', meaning: 'Something required to live and work, like housing and basic food.' }, { term: 'Want', meaning: 'Something that improves life but could be reduced or skipped.' }, { term: 'Pay yourself first', meaning: 'Plan savings at the start of the budget instead of saving only what is left.' }],
    checks: [{ question: 'Name one need and one want.', answer: 'For example, rent is a need and a streaming subscription is a want.' }, { question: 'Why is a starting split not a law?', answer: 'Everyone has different costs and income. It is a starting point to adjust, as long as the plan balances.' }],
    recap: ['Spending falls into needs, wants and savings.', 'Plan savings first, even if the amount is small.', 'Any split is a starting point to adapt to your life.'],
  },
  'l2-2': {
    title: 'Making the numbers work', moduleId: 'm2',
    intro: 'Now you put it together: write your income, list your costs, and adjust until the plan balances.',
    sections: [
      { heading: 'Step by step', body: 'Build the budget in this order:\n\n- Write down your expected income for the month. If it varies, use the lower amount you can count on.\n- List fixed costs first, because they are certain.\n- Add savings next.\n- Estimate variable costs using your tracking month.\n- Give what is left to wants.\n- Check that income minus all of it equals zero.' },
      { heading: 'When it does not balance', body: 'Often the first draft spends more than the income. You have only three levers: **earn more**, **spend less**, or **change the plan**, such as moving a goal later. Earning more takes time, so most people start with spending.\n\nLook at the largest variable costs first. Small cuts to large costs matter more than big cuts to tiny ones. Reduce wants before needs, and never plan to skip essentials you cannot skip.' },
      { heading: 'Irregular income', body: 'If your income changes from month to month, plan with the **lowest** amount you can reasonably expect. In a good month, give the extra money jobs in a set order: buffer first, then savings goals, then wants.\n\nThis way a bad month does not wreck the plan, and a good month moves you forward instead of disappearing.' },
    ],
    example: { title: 'Tunde balances a first draft', scenario: 'Tunde expects 90,000. His draft lists fixed costs 50,000, savings 10,000, food 20,000, transport 12,000 and fun 8,000.', walkthrough: 'The draft adds up to 100,000, which is 10,000 more than his income, so it does not balance. He looks at the biggest flexible items: food and transport. By cooking more often he trims food by 4,000 and by walking short trips he trims transport by 3,000. He lowers fun by 3,000. The plan now totals 90,000 and balances.' },
    keyTerms: [{ term: 'Lever', meaning: 'A way to fix an unbalanced budget: earn more, spend less, or change the plan.' }, { term: 'Variable income', meaning: 'Income that changes from month to month.' }, { term: 'Buffer', meaning: 'A small cushion in the plan for minor surprises.' }],
    checks: [{ question: 'Your first draft spends more than your income. What are your options?', answer: 'Earn more, spend less, or change the plan, for example by moving a goal to later.' }, { question: 'With irregular income, which amount do you plan with?', answer: 'The lowest amount you can reasonably count on.' }],
    recap: ['Fixed costs first, then savings, then estimates, then wants.', 'If it does not balance, adjust earning, spending or the plan.', 'Plan irregular income on the lower amount you can count on.'],
  },
  'l3-1': {
    title: 'Emergency funds and irregular costs', moduleId: 'm3',
    intro: 'A budget can fail because of surprises: a medical bill, a broken phone, a delayed payment. This lesson shows how to prepare for them calmly.',
    sections: [
      { heading: 'What an emergency fund is', body: 'An **emergency fund** is money set aside only for real surprises that you could not plan for, such as an urgent repair or a sudden loss of income. It sits apart from everyday money so you are not tempted to spend it.\n\nWithout one, a surprise often forces borrowing or cutting essentials. With one, a surprise is an inconvenience instead of a crisis.' },
      { heading: 'Building it gradually', body: 'You do not need to build it all at once. Start with a small first target, such as enough for a minor repair, then grow it toward several months of essential costs over time.\n\nSet up a regular small transfer right after you are paid. Small steady amounts build the habit and the balance. Keep it somewhere safe and easy to reach but not part of your daily spending money.' },
      { heading: 'Irregular costs are not emergencies', body: 'Some costs are not surprises, they are just not monthly: school fees, annual subscriptions, holidays, gifts, insurance. You know they are coming.\n\nTurn them into monthly amounts. If a yearly cost is 120,000, plan 10,000 a month into a separate pot. When the bill arrives, the money is waiting. This is called a **sinking fund**.' },
    ],
    example: { title: 'Chidi plans for school fees', scenario: 'Chidi pays 90,000 in school fees every September and usually has to borrow to cover it.', walkthrough: 'In January he divides 90,000 by the nine months before September and gets 10,000. He starts putting 10,000 a month into a separate pot. By September the full amount is waiting, so he does not borrow. Separately he keeps a small emergency fund for true surprises, so the two goals do not compete.' },
    keyTerms: [{ term: 'Emergency fund', meaning: 'Money set aside only for real, unplanned surprises.' }, { term: 'Sinking fund', meaning: 'Money saved monthly toward a known future cost, like fees.' }, { term: 'Paying yourself first', meaning: 'Moving savings right after payday, before spending.' }],
    checks: [{ question: 'Is school fees due every September an emergency?', answer: 'No. It is a known irregular cost, handled with a sinking fund.' }, { question: 'Why keep an emergency fund separate from daily money?', answer: 'So you are not tempted to spend it on everyday things, and it is there when a real surprise happens.' }],
    recap: ['An emergency fund covers real surprises, not planned costs.', 'Build it gradually with small regular transfers.', 'Known irregular costs belong in a sinking fund, saved monthly.'],
  },
  'l3-2': {
    title: 'Reviewing and adjusting every month', moduleId: 'm3',
    intro: 'A budget is not written once and forgotten. In this last lesson you will learn the simple monthly habit that keeps it useful.',
    sections: [
      { heading: 'A short monthly review', body: 'Once a month, take about twenty minutes to compare **plan** and **reality**. For each group, write what you planned and what you actually spent.\n\nLook for the biggest differences and ask why. Was the plan unrealistic, or did a one-off happen? The aim is to learn, not to blame yourself.' },
      { heading: 'Adjust, do not abandon', body: 'If you overspent in one group, you have two honest choices: move money from another group, or raise that group in next month\'s plan because the old number was unrealistic. Both are fine. What is not helpful is giving up the whole budget after one bad month.\n\nSmall adjustments, repeated, make a budget fit your real life. After a few months the numbers become accurate.' },
      { heading: 'Make it easy to keep', body: 'The best budget is the one you will actually use. Keep it simple: few groups, one place to record it, and a fixed time each month for the review.\n\nAutomate what you can: a standing transfer for savings and a reminder for bills. Celebrate progress too, such as reaching a first savings target. Habits last when they feel rewarding.' },
    ],
    example: { title: 'Zainab reviews her month', scenario: 'Zainab planned 25,000 for food but spent 31,000. She also saved the full amount she planned.', walkthrough: 'She notes the gap of 6,000 and checks the cause: two family dinners she had not planned for. One was a one-off, but her estimate was also a little low. She raises food to 28,000 next month and trims fun by 3,000 to keep the plan balanced. Her savings stay untouched, and she feels in control instead of discouraged.' },
    keyTerms: [{ term: 'Monthly review', meaning: 'A short regular check comparing the plan with what really happened.' }, { term: 'Adjustment', meaning: 'A small change to the plan based on what you learned.' }, { term: 'Automation', meaning: 'Setting up transfers or reminders so good habits happen by default.' }],
    checks: [{ question: 'You overspent on food. What are two sensible responses?', answer: 'Move money from another group, or raise food in the next plan if the old estimate was unrealistic.' }, { question: 'Why keep a budget simple?', answer: 'The best budget is the one you will actually keep using.' }],
    recap: ['Review plan against reality once a month.', 'Adjust the plan instead of abandoning it.', 'Keep it simple and automate what you can.'],
  },
};

const bank = {
  m1: [
    q('Which sentence best describes a budget?', ['A record of everything you spent last year', 'A plan for how you will use money you expect to receive, made before you spend it', 'A rule that you may never buy anything fun', 'A loan you take from a bank'], 1, ['A record of the past is tracking, not a budget.', 'Correct: a budget is a plan made before you spend.', 'A budget is not a ban on fun spending; it plans for it.', 'A budget has nothing to do with loans.']),
    q('Ada earns 100,000 and her plan spends 100,000 on specific jobs. What do we call this plan?', ['Overspent', 'Balanced', 'Broken', 'Fixed income'], 1, ['She spends exactly what she earns, so it is not overspent.', 'Correct: income minus planned uses equals zero.', 'The plan works, so it is not broken.', 'Fixed income describes a type of income, not a balanced plan.']),
    q('Why is it useful to track your spending for a month before building a budget?', ['It lets you get a refund', 'It shows where your money really goes, so the plan uses facts instead of guesses', 'It is required by law', 'It makes your income larger'], 1, ['Tracking does not give refunds.', 'Correct: it gives an honest picture to build on.', 'There is no such law for personal budgets.', 'Tracking does not change your income.']),
    q('Which of these is a fixed cost?', ['Your food spending, which changes each week', 'Monthly rent that stays the same', 'Transport costs that depend on trips', 'Money spent on gifts'], 1, ['Food spending varies, so it is variable.', 'Correct: rent usually stays the same each month.', 'Transport costs vary with trips.', 'Gifts vary from month to month.']),
    q('A friend says: "A budget is only for people with very little money." What is the best reply?', ['They are right', 'Planning helps at any income, because people with larger incomes can also lose track of spending', 'Budgets are only for businesses', 'Only banks need budgets'], 1, ['The habit of planning helps at any income level.', 'Correct: planning matters whatever your income.', 'Individuals use budgets too.', 'Individuals benefit from budgets.']),
    q('After tracking, Kofi finds snacks cost far more than he thought. What is the most helpful response?', ['Hide the numbers and carry on', 'Use the real number to plan a realistic amount and decide if he wants to change it', 'Quit tracking', 'Blame himself and plan to spend nothing on snacks'], 1, ['Ignoring facts defeats the purpose of tracking.', 'Correct: real numbers let him choose on purpose.', 'Quitting loses the useful information.', 'Planning zero is unrealistic and usually fails.']),
  ],
  m2: [
    q('Which of these is best described as a need?', ['A streaming subscription', 'Rent for your home', 'A new gadget', 'Eating out every night'], 1, ['A subscription is a want.', 'Correct: housing is a need.', 'A gadget is usually a want.', 'Regular eating out is mainly a want.']),
    q('What does "pay yourself first" mean?', ['Spend on yourself before bills', 'Plan savings at the start of the budget instead of saving only what is left over', 'Borrow money to save', 'Pay your bills late'], 1, ['It is about savings, not shopping.', 'Correct: savings get planned first.', 'It does not involve borrowing.', 'Late bills cause fees and problems.']),
    q('Your first draft budget spends more than your income. Which is NOT one of the three levers?', ['Earn more', 'Spend less', 'Hide the shortfall by ignoring one bill', 'Change the plan, for example by moving a goal later'], 2, ['Earning more is a real lever.', 'Spending less is a real lever.', 'Correct: ignoring a bill does not fix anything and creates problems.', 'Changing the plan is a real lever.']),
    q('Tunde\'s income is irregular. Which amount should he plan with?', ['The highest month he ever had', 'The lowest amount he can reasonably expect', 'An average of his dreams', 'Zero'], 1, ['Planning on the best month fails in a bad month.', 'Correct: plan on the amount you can count on.', 'Hopes are not a reliable basis.', 'Zero would make planning impossible.']),
    q('Maria earns 200 a week and plans needs 120, wants 50 and savings 20. How much is still unplanned?', ['Nothing is left', '10 a week', '30 a week', '50 a week'], 1, ['120 + 50 + 20 = 190, so 10 remains.', 'Correct: 200 - 190 = 10 still needs a job.', 'That would be the case if savings were zero.', 'That is the size of the wants only.']),
    q('Which order is recommended when building a budget?', ['Wants, then savings, then fixed costs', 'Income, fixed costs, savings, variable estimates, then wants', 'Savings last of all', 'Start with the largest want'], 1, ['Wants should come after the certain costs.', 'Correct: certain things first, flexible things last.', 'Savings should be planned early.', 'Wants come last.']),
  ],
  m3: [
    q('Which is the best use of an emergency fund?', ['A holiday you planned months ago', 'An urgent repair you could not have planned for', 'Annual school fees', 'A sale on something you like'], 1, ['A planned holiday is a known cost.', 'Correct: it is for true, unplanned surprises.', 'Known fees belong in a sinking fund.', 'A sale is a want, not an emergency.']),
    q('School fees of 90,000 are due in nine months. What monthly saving prepares for them?', ['1,000', '10,000', '90,000', '5,000'], 1, ['That would only reach 9,000.', 'Correct: 90,000 divided by 9 is 10,000.', 'That is the whole amount, not a monthly amount.', '5,000 a month reaches only 45,000.']),
    q('What is a sinking fund?', ['Money saved monthly toward a known future cost', 'A loan with high interest', 'A fund that always loses value', 'Money you hide from yourself'], 0, ['Correct: it spreads a known future cost across months.', 'A sinking fund is saving, not borrowing.', 'The name does not mean it loses value.', 'It is a planned, visible saving.']),
    q('After a month, Zainab overspent on food because of two unplanned family dinners. What is the most helpful reaction?', ['Give up budgeting', 'Compare plan and reality, then adjust the plan', 'Ignore the numbers', 'Plan zero for food next month'], 1, ['One bad month is not a reason to abandon the habit.', 'Correct: reviewing and adjusting is the point.', 'Ignoring the numbers prevents learning.', 'Zero for food is unrealistic.']),
    q('Which habit helps a budget survive in real life?', ['Make it as complicated as possible', 'Keep it simple and automate savings and reminders', 'Check it once every five years', 'Only record large purchases'], 1, ['Complex plans are often abandoned.', 'Correct: simple and automated is easier to keep.', 'Too rarely to be useful.', 'Small purchases add up too.']),
    q('How should you build an emergency fund?', ['All at once or not at all', 'Gradually, with small regular transfers after payday', 'By borrowing', 'By spending less on bills you cannot skip'], 1, ['You can start small and grow.', 'Correct: small steady amounts build the habit and the balance.', 'Borrowing does not build savings.', 'Skipping essential bills causes more problems.']),
  ],
};

/* store everything the server needs; the question bank stays server-side */
function seed(db) {
  if (db.courseById(ID)) return false;
  db.addCourse({ ...course, createdAt: '2026-01-01T00:00:00.000Z', bank }, null, 1e9);
  Object.entries(lessons).forEach(([id, l]) => db.putLesson(ID, { id, ...l, sources: [], research: 'none', writtenAt: '2026-01-01T00:00:00.000Z' }));
  return true;
}

/* an attempt drawn from the fixed bank: 5 of the module's 6 questions, or 8 of all 18 for the final, options reshuffled each time */
function attemptFromBank(c, moduleId) {
  const pool = moduleId === 'final' ? Object.values(c.bank).flat() : (c.bank[moduleId] || []);
  if (!pool.length) return null;
  const take = moduleId === 'final' ? 8 : 5, rnd = n => crypto.randomInt(n);
  const idx = pool.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = rnd(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const questions = idx.slice(0, take).map(i => {
    const src = pool[i], order = [0, 1, 2, 3]; for (let k = 3; k > 0; k--) { const j = rnd(k + 1); [order[k], order[j]] = [order[j], order[k]]; }
    return { type: 'mcq', question: src.question, options: order.map(o => src.options[o]), correct: order.indexOf(src.correct), explain: order.map(o => src.explain[o]) };
  });
  return { id: 'att_' + crypto.randomBytes(8).toString('hex'), courseId: c.id, moduleId, questions, createdAt: new Date().toISOString() };
}

module.exports = { ID, course, lessons, bank, seed, attemptFromBank };
